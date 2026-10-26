import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { SocialStore } from '../server/social.ts';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/game.ts';
import { CLASSIC_RANKS, initialRank, rankedCompatible } from '../shared/ranking.ts';

function friends(store: SocialStore) {
  const first = store.register('Alpha'); const second = store.register('Bravo');
  store.requestFriend(first.id, second.id); store.replyFriend(second.id, first.id, true); return { first, second };
}

test('social identities authenticate without exposing credentials and friends require consent', () => {
  const store = new SocialStore(); const first = store.register('Alpha'); const second = store.register('Bravo');
  assert.equal(store.authenticate(first), first.id); assert.equal(store.authenticate({ ...first, token: '0'.repeat(64) }), null);
  assert.ok(!JSON.stringify(store.state(first.id)).includes(first.token));
  assert.throws(() => store.requestFriend(first.id, first.id));
  assert.throws(() => store.replyFriend(first.id, second.id, true));
  store.requestFriend(first.id, second.id); assert.equal(store.state(second.id).incoming[0].id, first.id); assert.equal(store.state(first.id).friends.length, 0);
  store.replyFriend(second.id, first.id, true); assert.equal(store.state(first.id).friends[0].id, second.id); assert.equal(store.state(second.id).friends[0].id, first.id);
});

test('private messages and expiring 1v1 invites require mutual friendship and reject replay', () => {
  const store = new SocialStore(); const first = store.register('First'); const second = store.register('Second'); const stranger = store.register('Stranger');
  assert.throws(() => store.sendMessage(first.id, second.id, 'hello', 1000), /ACCEPTED FRIEND/);
  store.requestFriend(first.id, second.id); store.replyFriend(second.id, first.id, true);
  store.sendMessage(first.id, second.id, '  hello\u0000 friend  ', 1000);
  assert.equal(store.state(second.id).messages[0].text, 'hello friend'); assert.equal(store.state(stranger.id).messages.length, 0);
  assert.throws(() => store.sendMessage(first.id, second.id, 'too fast', 1200), /RATE LIMIT/);
  assert.throws(() => store.sendMessage(first.id, second.id, 'x'.repeat(401), 2000), /400/);
  assert.throws(() => store.inviteDuel(first.id, second.id, 3000), /ONLINE/);
  store.online.add(first.id); store.online.add(second.id);
  const expired = store.inviteDuel(first.id, second.id, 3000);
  assert.throws(() => store.replyDuel(second.id, expired, true, 64000), /NO LONGER/);
  const invite = store.inviteDuel(first.id, second.id, 65000);
  assert.throws(() => store.replyDuel(stranger.id, invite, true, 66000), /NO LONGER/);
  assert.equal(store.state(stranger.id, 66000).duels.length, 0);
  assert.equal(store.replyDuel(second.id, invite, true, 66000).status, 'accepted');
  assert.throws(() => store.replyDuel(second.id, invite, true, 66001), /NO LONGER/);
  store.removeFriend(first.id, second.id); assert.throws(() => store.sendMessage(first.id, second.id, 'no', 70000), /ACCEPTED FRIEND/);
});

test('classic ranks use strict rank and skill matching and apply each server result once', () => {
  assert.equal(CLASSIC_RANKS.length, 18); const first = initialRank();
  assert.equal(rankedCompatible(first, { ...first, rating: 1070, skill: 1080 }), true);
  assert.equal(rankedCompatible(first, { ...first, rating: 1100 }), false);
  assert.equal(rankedCompatible(first, { ...first, skill: 1101 }), false);
  const store = new SocialStore(); const account = store.register('Ranked');
  const before = store.rankedProfile(account.id); assert.equal(store.recordRankedResult(account.id, 'server-match-1', true, 1000, 12, 4), true);
  const ranked = store.rankedProfile(account.id); assert.ok(ranked.rating > before.rating); assert.equal(ranked.matches, 1);
  assert.equal(store.recordRankedResult(account.id, 'server-match-1', true, 1000, 12, 4), false); assert.deepEqual(store.rankedProfile(account.id), ranked);
  ranked.rating = 3000; assert.notEqual(store.rankedProfile(account.id).rating, 3000, 'callers cannot mutate stored ratings');
});

test('trade acceptance conserves item IDs, verifies ownership, locks offers and cannot be replayed', () => {
  const store = new SocialStore(); const { first, second } = friends(store); const outsider = store.register('Other');
  const firstItem = store.state(first.id).self.items[0]; const secondItem = store.state(second.id).self.items[0];
  const before = [...store.state(first.id).self.items, ...store.state(second.id).self.items].map(item => item.uid).sort();
  assert.throws(() => store.offerTrade(first.id, second.id, ['forged'], []));
  assert.throws(() => store.offerTrade(first.id, second.id, [firstItem.uid, firstItem.uid], []));
  assert.throws(() => store.offerTrade(first.id, outsider.id, [firstItem.uid], []));
  const offer = store.offerTrade(first.id, second.id, [firstItem.uid], [secondItem.uid]);
  assert.throws(() => store.offerTrade(first.id, second.id, [firstItem.uid], []));
  assert.throws(() => store.replyTrade(outsider.id, offer, 'accept')); assert.throws(() => store.replyTrade(first.id, offer, 'accept'));
  store.replyTrade(second.id, offer, 'accept'); assert.throws(() => store.replyTrade(second.id, offer, 'accept'));
  const after = [...store.state(first.id).self.items, ...store.state(second.id).self.items].map(item => item.uid).sort(); assert.deepEqual(after, before);
  assert.ok(store.state(first.id).self.items.some(item => item.uid === secondItem.uid)); assert.ok(store.state(second.id).self.items.some(item => item.uid === firstItem.uid));
});

test('cancelled, expired and stale trades never transfer items', () => {
  const store = new SocialStore(); const { first, second } = friends(store); const item = store.state(first.id).self.items[0];
  const cancelled = store.offerTrade(first.id, second.id, [item.uid], []); store.replyTrade(first.id, cancelled, 'cancel'); assert.throws(() => store.replyTrade(second.id, cancelled, 'accept'));
  const expired = store.offerTrade(first.id, second.id, [item.uid], [], 1000); assert.throws(() => store.replyTrade(second.id, expired, 'accept', 1000000));
  assert.equal(store.state(first.id).self.locked.length, 0);
  const pending = store.offerTrade(first.id, second.id, [item.uid], []); store.removeFriend(first.id, second.id); assert.throws(() => store.replyTrade(second.id, pending, 'accept'));
  assert.ok(store.state(first.id).self.items.some(owned => owned.uid === item.uid));
});

test('cloud purchases are atomic and arbitrary uploaded inventory cannot be inserted', () => {
  const store = new SocialStore(); const account = store.register('Buyer'); const before = store.state(account.id).self;
  assert.throws(() => store.buySkin(account.id, 'invalid')); assert.deepEqual(store.state(account.id).self, before);
  store.buySkin(account.id, 'rifle-2'); const after = store.state(account.id).self;
  assert.equal(after.items.length, before.items.length + 1); assert.ok(after.credits < before.credits);
});

test('cloud charm edits require ownership and cannot mutate locked or stale trade items', () => {
  const store = new SocialStore(); const { first, second } = friends(store); const item = store.state(first.id).self.items[0]; const requested = store.state(second.id).self.items[0];
  assert.throws(() => store.setCharm(second.id, item.uid, 'signal-gem'));
  assert.throws(() => store.setCharm(first.id, item.uid, 'signal-gem'));
  store.openCharmCase(first.id, 'signal-charms', () => 0); store.openCharmCase(second.id, 'field-charms', () => 0);
  store.setCharm(first.id, item.uid, 'signal-gem'); assert.equal(store.state(first.id).self.items[0].charm, 'signal-gem');
  const offer = store.offerTrade(first.id, second.id, [item.uid], [requested.uid]);
  assert.throws(() => store.setCharm(first.id, item.uid, 'cartridge'));
  store.setCharm(second.id, requested.uid, 'field-tag'); assert.throws(() => store.replyTrade(second.id, offer, 'accept'));
  assert.equal(store.state(first.id).trades[0].status, 'cancelled');
});

test('profiles persist with hashed credentials and avatar uploads become bounded WebP images', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'browserstrike-social-')); const path = join(directory, 'profiles.json');
  try {
    const store = new SocialStore(path); const account = store.register('Picture');
    await assert.rejects(store.updateProfile(account.id, 'Picture', 'data:image/svg+xml;base64,PHN2Zz4='));
    const image = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#459b91' } }).png().toBuffer();
    await store.updateProfile(account.id, 'Custom Name', `data:image/png;base64,${image.toString('base64')}`);
    const stored = await readFile(path, 'utf8'); assert.ok(!stored.includes(account.token));
    const reopened = new SocialStore(path); assert.equal(reopened.authenticate(account), account.id); const profile = reopened.state(account.id).self;
    assert.equal(profile.name, 'Custom Name'); assert.match(profile.avatar, /^data:image\/webp;base64,/);
    const metadata = await sharp(Buffer.from(profile.avatar.split(',')[1], 'base64')).metadata(); assert.equal(metadata.width, 128); assert.equal(metadata.height, 128);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('real social sockets exchange friend requests and atomically accept a trade', async () => {
  const game = createGameServer({ port: 0, host: '127.0.0.1' }); await once(game.http, 'listening'); const address = game.http.address(); assert.ok(address && typeof address !== 'string');
  const url = `ws://127.0.0.1:${address.port}/social`; const sockets: WebSocket[] = [];
  const waitFor = (socket: WebSocket, predicate: (message: any) => boolean) => new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('message', listener); reject(new Error('Social socket timed out')); }, 3000);
    const listener = (bytes: Buffer) => { const value = JSON.parse(bytes.toString()); if (predicate(value)) { clearTimeout(timer); socket.off('message', listener); resolve(value); } }; socket.on('message', listener);
  });
  try {
    const first = new WebSocket(url); const second = new WebSocket(url); sockets.push(first, second); await Promise.all([once(first, 'open'), once(second, 'open')]);
    const readyFirst = waitFor(first, message => message.type === 'social-ready'); const stateFirst = waitFor(first, message => message.type === 'social-state'); first.send(JSON.stringify({ type: 'auth', name: 'Socket A' })); const alpha = await readyFirst; const initial = await stateFirst;
    const readySecond = waitFor(second, message => message.type === 'social-ready'); second.send(JSON.stringify({ type: 'auth', name: 'Socket B' })); const bravo = await readySecond;
    const request = waitFor(second, message => message.type === 'social-state' && message.incoming.length === 1); first.send(JSON.stringify({ type: 'friend-request', target: bravo.id })); await request;
    const accepted = waitFor(first, message => message.type === 'social-state' && message.friends.length === 1); second.send(JSON.stringify({ type: 'friend-reply', target: alpha.id, accept: true })); const friendship = await accepted;
    const give = initial.self.items[0].uid; const receive = friendship.friends[0].items[0].uid;
    const offered = waitFor(second, message => message.type === 'social-state' && message.trades.length === 1); first.send(JSON.stringify({ type: 'trade-offer', target: bravo.id, give: [give], receive: [receive] })); const offer = (await offered).trades[0];
    const transferred = waitFor(second, message => message.type === 'social-state' && message.trades[0]?.status === 'accepted'); second.send(JSON.stringify({ type: 'trade-reply', trade: offer.id, action: 'accept' })); const result = await transferred; assert.ok(result.self.items.some((item: any) => item.uid === give));
    const replay = waitFor(second, message => message.type === 'social-error'); second.send(JSON.stringify({ type: 'trade-reply', trade: offer.id, action: 'accept' })); assert.match((await replay).text, /NO LONGER PENDING/);
  } finally { for (const socket of sockets) socket.close(); await game.close(); }
});