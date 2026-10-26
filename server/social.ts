import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import sharp from 'sharp';
import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { attachCharm, createProfile, itemValue, makeItem, openCharmCase, SKIN_BY_ID, validAppearance, type Profile } from '../shared/economy.ts';
import type { DirectMessage, DuelInvite, PublicProfile, SocialCredentials, SocialState, TradeOffer } from '../shared/social.ts';
import { applyRankedResult, initialRank, rankSummary, type RankedProfile } from '../shared/ranking.ts';

type Account = { id: string; tokenHash: string; name: string; avatar: string; profile: Profile; friends: string[]; requests: string[]; ranked?: RankedProfile };
type StoredSocial = { version: 1; accounts: Account[]; trades: TradeOffer[]; messages?: DirectMessage[]; duels?: DuelInvite[] };
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const cleanName = (name: unknown) => typeof name === 'string' ? name.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 24) || 'Operator' : 'Operator';

export class SocialStore {
  private accounts = new Map<string, Account>();
  private trades = new Map<string, TradeOffer>();
  private messages: DirectMessage[] = [];
  private duels = new Map<string, DuelInvite>();
  readonly online = new Set<string>();

  constructor(private path?: string) {
    if (!path || !existsSync(path)) return;
    const data = JSON.parse(readFileSync(path, 'utf8')) as StoredSocial;
    if (data.version !== 1 || !Array.isArray(data.accounts) || !Array.isArray(data.trades)) throw new Error('Invalid social store');
    for (const account of data.accounts) {
      if (!/^[A-F0-9]{12}$/.test(account.id) || !/^[a-f0-9]{64}$/.test(account.tokenHash) || !Array.isArray(account.profile?.items) || !account.profile.items.every(item => validAppearance(item))) throw new Error('Invalid stored account');
      this.accounts.set(account.id, account);
      if (!account.profile.unlockedCharms) account.profile.unlockedCharms = [...new Set(account.profile.items.flatMap(item => item.charm ? [item.charm] : []))];
      account.ranked ||= initialRank();
    }
    for (const trade of data.trades) this.trades.set(trade.id, trade);
    this.messages = data.messages || [];
    for (const duel of data.duels || []) this.duels.set(duel.id, duel);
  }

  private save() {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const data: StoredSocial = { version: 1, accounts: [...this.accounts.values()], trades: [...this.trades.values()], messages: this.messages, duels: [...this.duels.values()] };
    writeFileSync(`${this.path}.next`, JSON.stringify(data), { mode: 0o600 }); renameSync(`${this.path}.next`, this.path);
  }

  private account(id: string) { const account = this.accounts.get(id); if (!account) throw new Error('PROFILE NOT FOUND'); return account; }
  private identity(account: Account): PublicProfile { return { id: account.id, name: account.name, avatar: account.avatar, online: this.online.has(account.id), rank: rankSummary(account.ranked || initialRank()) }; }
  private expire(now: number) { for (const request of [...this.trades.values(), ...this.duels.values()]) if (request.status === 'pending' && request.expiresAt <= now) request.status = 'expired'; }
  private locked(id: string, uid: string, except?: string) { return [...this.trades.values()].some(trade => trade.status === 'pending' && trade.from === id && trade.id !== except && trade.give.includes(uid)); }

  register(name: unknown) {
    const token = randomBytes(32).toString('hex'); let id: string;
    do { id = randomBytes(6).toString('hex').toUpperCase(); } while (this.accounts.has(id));
    const profile = createProfile(); for (const item of profile.items) item.uid = randomUUID();
    profile.equipped = {};
    for (const item of profile.items) profile.equipped[SKIN_BY_ID.get(item.skinId)!.weapon] = item.uid;
    this.accounts.set(id, { id, tokenHash: tokenHash(token), name: cleanName(name), avatar: '', profile, friends: [], requests: [], ranked: initialRank() }); this.save();
    return { id, token } satisfies SocialCredentials;
  }

  authenticate(value: unknown) {
    if (!value || typeof value !== 'object') return null;
    const credentials = value as SocialCredentials;
    if (typeof credentials.id !== 'string' || typeof credentials.token !== 'string' || !/^[a-f0-9]{64}$/.test(credentials.token)) return null;
    const account = this.accounts.get(credentials.id); if (!account) return null;
    return timingSafeEqual(Buffer.from(account.tokenHash, 'hex'), Buffer.from(tokenHash(credentials.token), 'hex')) ? account.id : null;
  }

  async updateProfile(id: string, name: unknown, avatar?: unknown) {
    const account = this.account(id); let picture = account.avatar;
    if (avatar !== undefined) {
      if (avatar === '') picture = '';
      else {
        if (typeof avatar !== 'string' || avatar.length > 180000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar)) throw new Error('USE A PNG, JPEG OR WEBP PROFILE PICTURE');
        const bytes = Buffer.from(avatar.slice(avatar.indexOf(',') + 1), 'base64');
        const image = await sharp(bytes, { limitInputPixels: 4000000 }).rotate().resize(128, 128, { fit: 'cover' }).webp({ quality: 78 }).toBuffer();
        picture = `data:image/webp;base64,${image.toString('base64')}`;
      }
    }
    account.name = cleanName(name); account.avatar = picture; this.save();
  }

  requestFriend(id: string, target: string) {
    const account = this.account(id); const other = this.account(target);
    if (id === target) throw new Error('CANNOT ADD YOUR OWN PROFILE');
    if (account.friends.includes(target)) throw new Error('ALREADY FRIENDS');
    if (other.requests.includes(id)) throw new Error('FRIEND REQUEST ALREADY SENT');
    if (other.requests.length >= 50 || account.friends.length >= 100 || [...this.accounts.values()].filter(profile => profile.requests.includes(id)).length >= 25) throw new Error('FRIEND REQUEST LIMIT REACHED');
    other.requests.push(id); this.save();
  }

  replyFriend(id: string, from: string, accept: boolean) {
    const account = this.account(id); const other = this.account(from);
    if (!account.requests.includes(from)) throw new Error('FRIEND REQUEST NOT FOUND');
    if (accept && (account.friends.length >= 100 || other.friends.length >= 100)) throw new Error('FRIEND LIMIT REACHED');
    account.requests = account.requests.filter(request => request !== from);
    if (accept) { if (!account.friends.includes(from)) account.friends.push(from); if (!other.friends.includes(id)) other.friends.push(id); other.requests = other.requests.filter(request => request !== id); }
    this.save();
  }

  removeFriend(id: string, target: string) {
    const account = this.account(id); const other = this.account(target);
    account.friends = account.friends.filter(friend => friend !== target); other.friends = other.friends.filter(friend => friend !== id);
    for (const trade of this.trades.values()) if (trade.status === 'pending' && (trade.from === id && trade.to === target || trade.from === target && trade.to === id)) trade.status = 'cancelled';
    for (const duel of this.duels.values()) if (duel.status === 'pending' && (duel.from === id && duel.to === target || duel.from === target && duel.to === id)) duel.status = 'cancelled';
    this.save();
  }

  private friend(id: string, target: string) {
    const account = this.account(id); const other = this.account(target);
    if (id === target || !account.friends.includes(target) || !other.friends.includes(id)) throw new Error('AN ACCEPTED FRIEND IS REQUIRED');
    return other;
  }

  sendMessage(id: string, target: string, value: unknown, now = Date.now()) {
    this.friend(id, target);
    if (typeof value !== 'string' || value.length > 400) throw new Error('MESSAGES MUST BE 1 TO 400 CHARACTERS');
    const text = value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
    if (!text) throw new Error('MESSAGE IS EMPTY');
    if (this.messages.some(message => message.from === id && now - message.createdAt < 500)) throw new Error('MESSAGE RATE LIMIT');
    const message: DirectMessage = { id: randomUUID(), from: id, to: target, text, createdAt: now };
    this.messages.push(message);
    const thread = this.messages.filter(item => item.from === id && item.to === target || item.from === target && item.to === id);
    const removed = new Set(thread.slice(0, Math.max(0, thread.length - 100)).map(item => item.id));
    for (const owner of [id, target]) { const history = this.messages.filter(item => item.from === owner || item.to === owner); for (const item of history.slice(0, Math.max(0, history.length - 1000))) removed.add(item.id); }
    this.messages = this.messages.filter(item => !removed.has(item.id)); this.save(); return message.id;
  }

  inviteDuel(id: string, target: string, now = Date.now()) {
    this.expire(now); this.friend(id, target);
    if (!this.online.has(id) || !this.online.has(target)) throw new Error('BOTH PLAYERS MUST BE ONLINE');
    if ([...this.duels.values()].some(duel => duel.status === 'pending' && (duel.from === id || duel.to === id || duel.from === target || duel.to === target))) throw new Error('A 1V1 REQUEST IS ALREADY PENDING');
    if ([...this.duels.values()].some(duel => duel.from === id && now - duel.createdAt < 10000)) throw new Error('WAIT BEFORE SENDING ANOTHER 1V1 REQUEST');
    const duel: DuelInvite = { id: randomUUID(), from: id, to: target, status: 'pending', createdAt: now, expiresAt: now + 60000 };
    this.duels.set(duel.id, duel);
    for (const owner of [id, target]) { const history = [...this.duels.values()].filter(item => item.from === owner || item.to === owner); for (const item of history.slice(0, Math.max(0, history.length - 100))) this.duels.delete(item.id); }
    this.save(); return duel.id;
  }

  replyDuel(id: string, duelId: string, accept: boolean, now = Date.now()) {
    this.expire(now); const duel = this.duels.get(duelId);
    if (!duel || duel.status !== 'pending' || duel.to !== id) throw new Error('1V1 REQUEST IS NO LONGER AVAILABLE');
    if (accept) { this.friend(id, duel.from); if (!this.online.has(id) || !this.online.has(duel.from)) throw new Error('BOTH PLAYERS MUST BE ONLINE'); }
    duel.status = accept ? 'accepted' : 'declined'; this.save(); return structuredClone(duel);
  }

  private itemIds(value: unknown) {
    if (!Array.isArray(value) || value.length > 8 || !value.every(uid => typeof uid === 'string' && uid.length <= 100) || new Set(value).size !== value.length) throw new Error('SELECT UP TO EIGHT DISTINCT ITEMS');
    return value as string[];
  }
  private owned(account: Account, ids: string[], except?: string) {
    return ids.map(uid => { const item = account.profile.items.find(item => item.uid === uid); if (!item || this.locked(account.id, uid, except)) throw new Error('ITEM UNAVAILABLE OR LOCKED IN ANOTHER OFFER'); return item; });
  }

  offerTrade(id: string, target: string, give: unknown, receive: unknown, now = Date.now()) {
    this.expire(now); const account = this.account(id); const other = this.account(target);
    if (id === target || !account.friends.includes(target) || !other.friends.includes(id)) throw new Error('TRADES REQUIRE AN ACCEPTED FRIEND');
    if ([...this.trades.values()].filter(trade => trade.status === 'pending' && trade.from === id).length >= 20) throw new Error('TRADE OFFER LIMIT REACHED');
    const offered = this.itemIds(give); const requested = this.itemIds(receive); if (!offered.length) throw new Error('SELECT AN ITEM TO OFFER');
    const trade: TradeOffer = { id: randomUUID(), from: id, to: target, give: offered, receive: requested, offered: structuredClone(this.owned(account, offered)), requested: structuredClone(this.owned(other, requested)), status: 'pending', createdAt: now, expiresAt: now + 15 * 60000 };
    this.trades.set(trade.id, trade); this.save(); return trade.id;
  }

  replyTrade(id: string, tradeId: string, action: 'accept' | 'decline' | 'cancel', now = Date.now()) {
    this.expire(now); const trade = this.trades.get(tradeId);
    if (!trade || trade.status !== 'pending') throw new Error('TRADE IS NO LONGER PENDING');
    if (action === 'cancel' ? trade.from !== id : trade.to !== id) throw new Error('NOT YOUR TRADE REQUEST');
    if (action !== 'accept') { trade.status = action === 'cancel' ? 'cancelled' : 'declined'; this.save(); return; }
    const from = this.account(trade.from); const to = this.account(trade.to);
    if (!from.friends.includes(to.id) || !to.friends.includes(from.id)) throw new Error('FRIENDSHIP NO LONGER ACTIVE');
    const offered = this.owned(from, trade.give, trade.id); const requested = this.owned(to, trade.receive);
    const oldFrom = from.profile; const oldTo = to.profile;
    from.profile = structuredClone(from.profile); to.profile = structuredClone(to.profile);
    from.profile.items = from.profile.items.filter(item => !trade.give.includes(item.uid)).concat(structuredClone(requested));
    to.profile.items = to.profile.items.filter(item => !trade.receive.includes(item.uid)).concat(structuredClone(offered));
    for (const account of [from, to]) for (const weapon of Object.keys(account.profile.equipped) as (keyof Profile['equipped'])[]) if (!account.profile.items.some(item => item.uid === account.profile.equipped[weapon])) delete account.profile.equipped[weapon];
    trade.status = 'accepted';
    try { this.save(); } catch (error) { from.profile = oldFrom; to.profile = oldTo; trade.status = 'pending'; throw error; }
  }

  buySkin(id: string, skinId: string) {
    const account = this.account(id); if (!SKIN_BY_ID.has(skinId)) throw new Error('UNKNOWN FINISH');
    if (account.profile.items.length >= 2000) throw new Error('INVENTORY LIMIT REACHED');
    const item = { ...makeItem(skinId), uid: randomUUID(), float: 0.06, statTrak: false }; const price = Math.round(itemValue(item) * 1.4);
    if (account.profile.credits < price) throw new Error('INSUFFICIENT CLOUD CREDITS');
    account.profile.credits -= price; account.profile.items.push(item); this.save();
  }

  setCharm(id: string, uid: string, charm: unknown) {
    this.expire(Date.now()); const account = this.account(id);
    if (this.locked(id, uid)) throw new Error('CANCEL THE ACTIVE OFFER BEFORE EDITING THIS ITEM');
    if (!attachCharm(account.profile, uid, charm)) throw new Error('INVALID ITEM OR CHARM');
    for (const trade of this.trades.values()) if (trade.status === 'pending' && trade.to === id && trade.receive.includes(uid)) trade.status = 'cancelled';
    this.save();
  }

  openCharmCase(id: string, caseId: string, random = Math.random) {
    const account = this.account(id); const charm = openCharmCase(account.profile, caseId, random);
    if (!charm) throw new Error('CHARM CASE UNAVAILABLE, COMPLETE OR INSUFFICIENT CREDITS'); this.save(); return charm;
  }

  award(id: string, amount: number) { const account = this.accounts.get(id); if (account && Number.isSafeInteger(amount) && amount > 0) { account.profile.credits = Math.min(10000000, account.profile.credits + amount); this.save(); } }

  rankedProfile(id: string) { const account = this.account(id); return structuredClone(account.ranked ||= initialRank()); }
  recordRankedResult(id: string, match: string, won: boolean, opponentRating: number, kills: number, deaths: number) {
    const account = this.account(id); const changed = applyRankedResult(account.ranked ||= initialRank(), match, won, opponentRating, kills, deaths); if (changed) this.save(); return changed;
  }

  state(id: string, now = Date.now()): SocialState {
    this.expire(now); const account = this.account(id); const trades = [...this.trades.values()].filter(trade => trade.from === id || trade.to === id).sort((first, second) => second.createdAt - first.createdAt).slice(0, 100);
    return structuredClone({ type: 'social-state', self: { ...this.identity(account), items: account.profile.items, credits: account.profile.credits, locked: account.profile.items.filter(item => this.locked(id, item.uid)).map(item => item.uid), charms: account.profile.unlockedCharms || [] }, friends: account.friends.map(friend => { const other = this.account(friend); return { ...this.identity(other), items: other.profile.items }; }), incoming: account.requests.map(from => this.identity(this.account(from))), outgoing: [...this.accounts.values()].filter(other => other.requests.includes(id)).map(other => this.identity(other)), trades, messages: this.messages.filter(message => message.from === id || message.to === id), duels: [...this.duels.values()].filter(duel => duel.from === id || duel.to === id) });
  }
}

export function createSocialService(options: { path?: string; origins?: string[]; onDuel?: (duel: DuelInvite) => string } = {}) {
  const store = new SocialStore(options.path); const sockets = new WebSocketServer({ noServer: true, maxPayload: 200000 });
  const sessions = new Map<WebSocket, { id: string; since: number; count: number; pongAt: number }>();
  const registrations = new Map<string, { since: number; count: number }>();
  const send = (socket: WebSocket, value: unknown) => { if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 2000000) socket.send(JSON.stringify(value)); };
  const broadcast = () => { for (const [socket, session] of sessions) send(socket, store.state(session.id)); };
  sockets.on('connection', (socket, request) => {
    let queue = Promise.resolve(); const deadline = setTimeout(() => { if (!sessions.has(socket)) socket.close(1008, 'Authentication required'); }, 10000);
    socket.on('pong', () => { const session = sessions.get(socket); if (session) session.pongAt = Date.now(); });
    socket.on('message', data => {
      queue = queue.then(async () => {
        const message = JSON.parse(data.toString()) as Record<string, unknown>; const now = Date.now();
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('INVALID SOCIAL REQUEST');
        let session = sessions.get(socket);
        if (!session) {
          if (message.type !== 'auth') throw new Error('AUTHENTICATION REQUIRED');
          let credentials: SocialCredentials | undefined; let id = store.authenticate(message.credentials);
          if (message.credentials && !id) { socket.close(1008, 'Invalid profile credentials'); return; }
          if (!id) {
            const address = request.socket.remoteAddress || 'local'; const bucket = registrations.get(address);
            if (bucket && now - bucket.since < 60000 && bucket.count >= 20) throw new Error('PROFILE CREATION RATE LIMIT');
            registrations.set(address, !bucket || now - bucket.since >= 60000 ? { since: now, count: 1 } : { ...bucket, count: bucket.count + 1 });
            credentials = store.register(message.name); id = credentials.id;
          }
          session = { id, since: now, count: 0, pongAt: now }; sessions.set(socket, session); store.online.add(id); clearTimeout(deadline);
          send(socket, { type: 'social-ready', id, credentials }); broadcast(); return;
        }
        if (now - session.since >= 1000) { session.since = now; session.count = 0; }
        if (++session.count > 12) { socket.close(1008, 'Social rate limit'); return; }
        if (message.type === 'profile') await store.updateProfile(session.id, message.name, message.avatar);
        else if (message.type === 'friend-request' && typeof message.target === 'string') store.requestFriend(session.id, message.target);
        else if (message.type === 'friend-reply' && typeof message.target === 'string' && typeof message.accept === 'boolean') store.replyFriend(session.id, message.target, message.accept);
        else if (message.type === 'friend-remove' && typeof message.target === 'string') store.removeFriend(session.id, message.target);
        else if (message.type === 'direct-message' && typeof message.target === 'string') store.sendMessage(session.id, message.target, message.text);
        else if (message.type === 'duel-invite' && typeof message.target === 'string') store.inviteDuel(session.id, message.target);
        else if (message.type === 'duel-reply' && typeof message.duel === 'string' && typeof message.accept === 'boolean') {
          const duel = store.replyDuel(session.id, message.duel, message.accept);
          if (duel.status === 'accepted' && options.onDuel) { const code = options.onDuel(duel); for (const [peer, identity] of sessions) if (identity.id === duel.from || identity.id === duel.to) send(peer, { type: 'duel-ready', code, duel: duel.id }); }
        }
        else if (message.type === 'trade-offer' && typeof message.target === 'string') store.offerTrade(session.id, message.target, message.give, message.receive);
        else if (message.type === 'trade-reply' && typeof message.trade === 'string' && ['accept', 'decline', 'cancel'].includes(String(message.action))) store.replyTrade(session.id, message.trade, message.action as 'accept' | 'decline' | 'cancel');
        else if (message.type === 'buy-finish' && typeof message.skin === 'string') store.buySkin(session.id, message.skin);
        else if (message.type === 'charm' && typeof message.uid === 'string') store.setCharm(session.id, message.uid, message.charm);
        else if (message.type === 'charm-case' && typeof message.case === 'string') store.openCharmCase(session.id, message.case);
        else if (message.type !== 'refresh') throw new Error('UNKNOWN SOCIAL REQUEST');
        send(socket, { type: 'social-ok', action: message.type }); broadcast();
      }).catch(error => { send(socket, { type: 'social-error', text: error instanceof Error ? error.message : 'SOCIAL REQUEST FAILED' }); });
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      clearTimeout(deadline); const id = sessions.get(socket)?.id; sessions.delete(socket);
      if (id && ![...sessions.values()].some(session => session.id === id)) store.online.delete(id); broadcast();
    });
  });
  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const [socket, session] of sessions) { if (now - session.pongAt > 60000) socket.terminate(); else socket.ping(); }
    for (const [address, entry] of registrations) if (now - entry.since > 60000) registrations.delete(address);
  }, 30000);
  return {
    store, broadcast,
    upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
      const origin = request.headers.origin;
      if (options.origins?.length && (!origin || !options.origins.includes(origin))) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
      sockets.handleUpgrade(request, socket, head, connection => sockets.emit('connection', connection, request));
    },
    async close() { clearInterval(heartbeat); for (const socket of sockets.clients) socket.terminate(); await new Promise<void>(resolve => sockets.close(() => resolve())); },
  };
}