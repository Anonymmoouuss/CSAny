import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { WebSocket, WebSocketServer } from 'ws';
import { Ray, Vector3 } from 'three';
import {
  createPlayer, equipPlayer, hasRespawns, simulateMovement, spawn, STEP, WEAPONS, THROWABLES, MAPS, SUPPLIED_MAP_IDS,
  type GameEvent, type Input, type MapId, type Mode, type Phase, type Player, type Snapshot, type Team, type Vec, type WeaponId, type ThrowableId,
} from '../shared/game.ts';
import { creditReward, validAppearance } from '../shared/economy.ts';
import { createSocialService } from './social.ts';
import { emptyBomb, beginRound as beginSharedRound, advanceRound, dropBomb, dropWeapon, pickupWeapon, interactBomb, purchaseEquipment, recordModeKill, finishRound } from '../shared/round.ts';
import { equipGunGame } from '../shared/modes.ts';
import { rankIndex, rankedBotDifficulty, rankedCompatible } from '../shared/ranking.ts';
import { fireHitscan } from '../shared/combat.ts';
import { decodeInputs, HitboxHistory, SERVER_TICK_RATE, SNAPSHOT_RATE } from '../shared/protocol.ts';
import { botInput, createBrain, type BotBrain } from '../shared/bots.ts';
import { mapGeometry, registerMapGeometry } from '../shared/map-geometry.ts';
import { advanceEquipment, throwEquipment } from '../shared/equipment.ts';

type Client = { socket: WebSocket; player: Player; accountId?: string; queue: Input[]; lastSeq: number; lastMessage: number; messages: number; lastChat: number; alive: boolean };
export type Room = {
  visibility: 'public' | 'private';
  code: string; mode: Mode; map: MapId; clients: Map<string, Client>; events: GameEvent[]; history: HitboxHistory; nextBroadcast?: number;
  phase: Phase; endsAt: number; score: Record<Team, number>; winner?: Team;
  buyEndsAt?: number; matchWinner?: Team;
  matchComplete?: boolean; matchDraw?: boolean; winnerId?: string; hill?: Snapshot['hill']; gunGame?: Snapshot['gunGame']; difficulty?: Snapshot['difficulty'];
  rankIndex?: number; rankedRecorded?: boolean;
  reserved?: string[]; expiresAt?: number; matchId?: string;
  projectiles?: Snapshot['projectiles'];
  drops?: Snapshot['drops'];
  smokes?: Snapshot['smokes']; fires?: Snapshot['fires'];
  bomb: Snapshot['bomb']; round: number; bots: Player[]; brains: Map<string, BotBrain>;
  environment?: Snapshot['environment']; killsAtStart?: Record<string, number>;
};
const weaponIds = Object.keys(WEAPONS) as WeaponId[];
const clean = (value: string, max: number) => value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max);

export function createGameServer(options: { port?: number; host?: string; origins?: string[]; socialPath?: string } = {}) {
  const rooms = new Map<string, Room>();
  let closing = false;
  const social = createSocialService({ path: options.socialPath, origins: options.origins, onDuel: duel => createRoom('duel', 'private', [duel.from, duel.to]).code });
  const http = createServer((request, response) => {
    response.writeHead(request.url === '/health' ? 200 : 404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(request.url === '/health' ? { ok: true, rooms: rooms.size, tickRate: SERVER_TICK_RATE, snapshotRate: SNAPSHOT_RATE } : { error: 'Not found' }));
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 16384, perMessageDeflate: { threshold: 1024, concurrencyLimit: 4, zlibDeflateOptions: { level: 1 } } });
  http.on('upgrade', (request, socket, head) => {
    if (request.url === '/social') { social.upgrade(request, socket, head); return; }
    const origin = request.headers.origin;
    if (request.url !== '/ws' || (options.origins?.length && (!origin || !options.origins.includes(origin)))) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return;
    }
    sockets.handleUpgrade(request, socket, head, connection => sockets.emit('connection', connection));
  });
  const send = (socket: WebSocket, data: unknown) => {
    if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 256000) socket.send(JSON.stringify(data));
  };

  function allPlayers(room: Room) { return [...room.clients.values()].map(client => client.player).concat(room.bots); }

  function cosmetics(value: unknown): Player['cosmetics'] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).slice(0, 21).filter(([id, appearance]) => weaponIds.includes(id as WeaponId) && validAppearance(appearance, id as WeaponId)).map(([id, appearance]) => {
      const item = appearance as NonNullable<Player['cosmetics'][WeaponId]>;
      return [id, { skinId: item.skinId, seed: item.seed, float: item.float, statTrak: item.statTrak, kills: item.kills, charm: item.charm }];
    }));
  }

  function beginRound(room: Room) {
    beginSharedRound(room, allPlayers(room), Date.now());
    for (const client of room.clients.values()) client.queue = [];
  }

  function createRoom(mode: Mode, visibility: Room['visibility'], reserved?: string[]) {
    let code: string; do { code = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
    const map = SUPPLIED_MAP_IDS[Math.floor(Math.random() * SUPPLIED_MAP_IDS.length)];
    if (MAPS[map].imported && !mapGeometry(map)) registerMapGeometry(map, readFileSync(new URL(`../client/public/models/imported/${map}.collision.bin`, import.meta.url)));
    const room: Room = { code, visibility, mode, map, clients: new Map(), events: [], history: new HitboxHistory(), phase: 'waiting', endsAt: 0, score: { T: 0, CT: 0 }, bomb: emptyBomb(), round: 0, bots: [], brains: new Map(), reserved, expiresAt: reserved ? Date.now() + 90000 : undefined, matchId: randomUUID() };
    rooms.set(code, room); return room;
  }

  function fillBots(room: Room) {
    const needed = room.mode === 'duel' ? 0 : Math.max(0, 10 - room.clients.size);
    while (room.bots.length > needed) { const bot = room.bots.pop()!; dropBomb(room, bot); room.brains.delete(bot.id); }
    while (room.bots.length < needed) {
      const players = allPlayers(room); const index = room.bots.length;
      const team: Team = players.filter(player => player.team === 'T').length <= players.filter(player => player.team === 'CT').length ? 'T' : 'CT';
      const bot = createPlayer(`bot-${randomUUID()}`, ['Morrow', 'Rook', 'Switch', 'Cinder', 'North'][index % 5], team, room.mode, index);
      if (room.mode === 'ranked') bot.botSkill = room.rankIndex || 0;
      bot.weapon = room.mode === 'deathmatch' ? (['carbine', 'smg', 'rifle', 'scout', 'compactSmg'] as WeaponId[])[index % 5] : 'pistol';
      if (!bot.owned.includes(bot.weapon)) bot.owned.push(bot.weapon);
      spawn(bot, index + 5, room.map, players, room.mode === 'gungame', room.mode === 'gungame'); bot.skin = index % 12;
      if (!hasRespawns(room.mode) && room.phase === 'live') bot.hp = 0;
      if (room.gunGame) { room.gunGame.levels[bot.id] = 0; room.gunGame.killsAtStart[bot.id] = 0; equipGunGame(bot, 0); }
      room.bots.push(bot); room.brains.set(bot.id, createBrain(index));
    }
  }

  function fire(room: Room, player: Player, input: Input, now: number) {
    if (room.phase === 'buy' || room.phase === 'over') return;
    const rewindTime = Math.max(now - 250, Math.min(now, input.time));
    const shot = fireHitscan(player, allPlayers(room), input, now, room.map, { mode: room.mode, positions: room.history.sample(rewindTime), utility: room, damageEnabled: room.phase !== 'waiting' });
    if (!shot) return;
    room.events.push(...shot.events);
    for (const victim of shot.killed) {
      victim.respawnAt = hasRespawns(room.mode) ? now + 1100 : 0;
      dropBomb(room, victim);
      if (room.mode !== 'gungame') for (const weapon of [...victim.owned]) dropWeapon(room, victim, weapon, now);
      recordModeKill(room, allPlayers(room), player, shot.events[0].weapon!, now);
    }
  }

  function interact(room: Room, player: Player, active: boolean) {
    interactBomb(room, player, active, STEP * 1000, Date.now(), allPlayers(room));
  }

  sockets.on('connection', socket => {
    let joined: { room: Room; client: Client } | undefined;
    let received = 0;
    const joinTimeout = setTimeout(() => { if (!joined) socket.close(1008, 'Join timeout'); }, 10000);
    socket.on('pong', () => { if (joined) joined.client.alive = true; });
    socket.on('message', (data, binary) => {
      try {
        if (!joined && ++received > 5) { socket.close(1008, 'Join required'); return; }
        const message = binary ? { type: 'inputs', inputs: decodeInputs(Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : new Uint8Array(data)) } : JSON.parse(data.toString());
        const now = Date.now();
        if (message.type === 'join' && !joined) {
          if (typeof message.name !== 'string' || typeof message.code !== 'string') return;
          const accountId = social.store.authenticate(message.account);
          if (message.account && !accountId) { send(socket, { type: 'error', text: 'PROFILE AUTHENTICATION FAILED' }); return; }
          const name = clean(message.name, 18) || 'Operator';
          let code = message.code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
          const matchmaking = message.matchmaking === true;
          const mode: Mode = ['defusal', 'hill', 'gungame', 'ranked'].includes(message.mode) ? message.mode : 'deathmatch';
          if (mode === 'ranked' && (!accountId || !matchmaking)) { send(socket, { type: 'error', text: 'RANKED REQUIRES A PROFILE AND PUBLIC MATCHMAKING' }); return; }
          if (mode === 'ranked' && [...rooms.values()].some(candidate => candidate.mode === 'ranked' && [...candidate.clients.values()].some(client => client.accountId === accountId))) { send(socket, { type: 'error', text: 'PROFILE ALREADY HAS AN ACTIVE RANKED MATCH' }); return; }
          const skill = accountId ? social.store.rankedProfile(accountId) : undefined;
          const compatible = (candidate: Room) => candidate.mode !== 'ranked' || !!skill && [...candidate.clients.values()].every(client => !!client.accountId && rankedCompatible(skill, social.store.rankedProfile(client.accountId)));
          let room = matchmaking ? [...rooms.values()].find(candidate => candidate.visibility === 'public' && candidate.mode === mode && candidate.clients.size < 10 && !candidate.matchWinner && !candidate.matchComplete && compatible(candidate)) : rooms.get(code);
          if (!room && (matchmaking || message.create === true)) {
            room = createRoom(mode, matchmaking ? 'public' : 'private');
            if (mode === 'ranked' && skill) { room.rankIndex = rankIndex(skill.rating); room.difficulty = rankedBotDifficulty(room.rankIndex); }
          }
          if (!room) { send(socket, { type: 'error', text: 'Room not found. Check the code or create a room.' }); return; }
          if (room.reserved && (!accountId || !room.reserved.includes(accountId) || [...room.clients.values()].some(client => client.accountId === accountId) || room.matchComplete || room.expiresAt! <= now && room.phase === 'waiting')) { send(socket, { type: 'error', text: 'THIS 1V1 ROOM IS RESERVED OR EXPIRED' }); return; }
          if (room.mode === 'ranked' && (!accountId || !compatible(room))) { send(socket, { type: 'error', text: 'RANK AND SKILL DO NOT MATCH THIS ROOM' }); return; }
          if (!matchmaking && room.visibility === 'public') { send(socket, { type: 'error', text: 'Use public matchmaking to join this match.' }); return; }
          code = room.code;
          if (room.clients.size >= (room.mode === 'duel' ? 2 : 10)) { send(socket, { type: 'error', text: 'This room is full.' }); return; }
          const teams = [...room.clients.values()].map(client => client.player.team);
          const team: Team = teams.filter(value => value === 'T').length <= teams.filter(value => value === 'CT').length ? 'T' : 'CT';
          const replaced = room.bots.findIndex(bot => bot.team === team);
          if (replaced >= 0) { const [bot] = room.bots.splice(replaced, 1); dropBomb(room, bot); room.brains.delete(bot.id); }
          const player = createPlayer(randomUUID(), name, team, room.mode, room.clients.size);
          player.cosmetics = cosmetics(message.cosmetics);
          spawn(player, room.clients.size, room.map, allPlayers(room), room.mode === 'deathmatch' || room.mode === 'gungame', room.mode === 'gungame');
          if (Number.isInteger(message.skin)) player.skin = Math.max(0, Math.min(11, message.skin));
          if (Number.isInteger(message.knifeStyle)) player.knifeStyle = Math.max(0, Math.min(49, message.knifeStyle));
          if (!hasRespawns(room.mode) && room.phase === 'live') player.hp = 0;
          if (room.gunGame) { room.gunGame.levels[player.id] = 0; room.gunGame.killsAtStart[player.id] = 0; equipGunGame(player, 0); }
          const client: Client = { socket, player, accountId: accountId || undefined, queue: [], lastSeq: -1, lastMessage: now, messages: 0, lastChat: 0, alive: true };
          room.clients.set(player.id, client); joined = { room, client }; clearTimeout(joinTimeout);
          fillBots(room);
          send(socket, { type: 'welcome', id: player.id, code, mode: room.mode, map: room.map, tickRate: SERVER_TICK_RATE, snapshotRate: SNAPSHOT_RATE });
          room.events.push({ type: 'chat', text: `${name} connected`, id: 'server' });
          if (allPlayers(room).length >= 2 && room.phase === 'waiting') beginRound(room);
          return;
        }
        if (!joined) return;
        const { room, client } = joined;
        if (now - client.lastMessage > 1000) { client.lastMessage = now; client.messages = 0; }
        if (++client.messages > 100) { socket.close(1008, 'Rate limit'); return; }
        if (message.type === 'ping') { send(socket, { type: 'pong', sent: message.sent, time: now }); return; }
        if (message.type === 'inputs' && Array.isArray(message.inputs)) {
          for (const input of message.inputs.slice(0, 6)) {
            if (!input || !['seq', 'time', 'yaw', 'pitch', 'forward', 'side'].every(key => Number.isFinite(input[key])) ||
              !Number.isSafeInteger(input.seq) || input.seq <= client.lastSeq || !weaponIds.includes(input.weapon)) continue;
            client.lastSeq = input.seq;
            const safe: Input = {
              seq: input.seq, time: Math.max(now - 1000, Math.min(now + 100, input.time)),
              yaw: input.yaw % (Math.PI * 2), pitch: Math.max(-1.5, Math.min(1.5, input.pitch)),
              forward: Math.max(-1, Math.min(1, input.forward)), side: Math.max(-1, Math.min(1, input.side)),
              jump: input.jump === true, crouch: input.crouch === true, sprint: false,
              fire: input.fire === true, reload: input.reload === true, scope: input.scope === true,
              interact: input.interact === true, weapon: input.weapon,
            };
            if (client.queue.length < 30) client.queue.push(safe);
          }
        }
        if (message.type === 'chat' && typeof message.text === 'string' && now - client.lastChat > 600) {
          const text = clean(message.text, 120);
          if (text) { room.events.push({ type: 'chat', id: client.player.id, text }); client.lastChat = now; }
        }
        if (message.type === 'skin' && Number.isInteger(message.skin)) client.player.skin = Math.max(0, Math.min(11, message.skin));
        if (message.type === 'cosmetics') client.player.cosmetics = cosmetics(message.cosmetics);
        if (message.type === 'knife' && Number.isInteger(message.style)) client.player.knifeStyle = Math.max(0, Math.min(49, message.style));
        if (message.type === 'throw' && typeof message.item === 'string' && Object.hasOwn(THROWABLES, message.item)) {
          if (!throwEquipment(room, client.player, message.item as ThrowableId, now)) send(socket, { type: 'error', text: 'THROWABLE UNAVAILABLE' });
        }
        if (message.type === 'buy' && typeof message.item === 'string') {
          const error = purchaseEquipment(room, client.player, message.item, now);
          if (error) send(socket, { type: 'error', text: error });
          else client.queue = [];
        }
        if (message.type === 'pickup') pickupWeapon(room, client.player, now);
        if (message.type === 'drop' && room.mode !== 'gungame' && client.player.hp > 0 && room.phase !== 'over') dropWeapon(room, client.player, client.player.weapon, now);
      } catch { send(socket, { type: 'error', text: 'Invalid message.' }); }
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      clearTimeout(joinTimeout);
      if (!joined) return;
      const { room, client } = joined;
      dropBomb(room, client.player);
      if (!closing && room.mode === 'ranked' && client.accountId && !room.matchComplete) { social.store.recordRankedResult(client.accountId, `ranked:${room.matchId}`, false, social.store.rankedProfile(client.accountId).rating, client.player.kills, client.player.deaths); social.broadcast(); }
      room.clients.delete(client.player.id);
      if (room.mode === 'duel' && room.clients.size && room.phase !== 'waiting' && !room.matchComplete) {
        const winner = [...room.clients.values()][0].player; room.phase = 'live'; finishRound(room, allPlayers(room), winner.team, Date.now()); room.matchWinner = winner.team; room.matchComplete = true; room.endsAt = 0;
      }
      room.events.push({ type: 'chat', id: 'server', text: `${client.player.name} disconnected` });
      if (!room.clients.size) rooms.delete(room.code);
      else fillBots(room);
    });
  });

  let lastTick = performance.now(); let accumulated = 0;
  const ticker = setInterval(() => {
    const clock = performance.now(); accumulated = Math.min(250, accumulated + clock - lastTick); lastTick = clock;
    let catchup = 0;
    while (accumulated >= STEP * 1000 && catchup++ < 8) {
    accumulated -= STEP * 1000;
    const now = performance.timeOrigin + clock - accumulated;
    for (const room of rooms.values()) {
      if (room.reserved && room.phase === 'waiting' && now >= room.expiresAt!) { for (const client of room.clients.values()) { send(client.socket, { type: 'error', text: '1V1 REQUEST EXPIRED' }); client.socket.close(); } rooms.delete(room.code); continue; }
      advanceRound(room, allPlayers(room), now);
      for (const client of room.clients.values()) {
        const player = client.player;
        if (player.respawnAt && now >= player.respawnAt) { spawn(player, player.deaths, room.map, allPlayers(room), true, room.mode === 'gungame'); player.armor = 100; if (room.gunGame) equipGunGame(player, room.gunGame.levels[player.id] || 0); }
        if (player.reloading && now >= player.reloading) {
          const amount = Math.min(WEAPONS[player.weapon].capacity - player.ammo[player.weapon], player.reserve[player.weapon]);
          player.ammo[player.weapon] += amount; player.reserve[player.weapon] -= amount; player.reloading = 0;
        }
        for (let count = 0; count < 1 && client.queue.length; count++) {
          const input = client.queue.shift()!;
          player.seq = input.seq;
          equipPlayer(player, input.weapon);
          const frozen = room.phase === 'buy' || room.phase === 'over';
          simulateMovement(player, input, frozen, room.map);
          if (player.hp <= 0 || frozen) continue;
          if (input.reload && !player.reloading && player.weapon !== 'knife' && player.ammo[player.weapon] < WEAPONS[player.weapon].capacity && player.reserve[player.weapon] > 0) {
            player.reloading = now + WEAPONS[player.weapon].reload;
            room.events.push({ type: 'reload', id: player.id });
          }
          if (input.fire) fire(room, player, input, now);
          interact(room, player, input.interact);
        }
      }
      for (const bot of room.bots) {
        if (bot.respawnAt && now >= bot.respawnAt) { spawn(bot, bot.deaths, room.map, allPlayers(room), true, room.mode === 'gungame'); bot.armor = 100; if (room.gunGame) equipGunGame(bot, room.gunGame.levels[bot.id] || 0); }
        if (bot.reloading && now >= bot.reloading) {
          const amount = Math.min(WEAPONS[bot.weapon].capacity - bot.ammo[bot.weapon], bot.reserve[bot.weapon]);
          bot.ammo[bot.weapon] += amount; bot.reserve[bot.weapon] -= amount; bot.reloading = 0;
        }
        for (let step = 0; step < 1; step++) {
          const tickTime = now;
          const input = botInput(bot, allPlayers(room), room, room.brains.get(bot.id)!, tickTime);
          simulateMovement(bot, input, room.phase !== 'live', room.map);
          if (bot.hp <= 0 || room.phase !== 'live') continue;
          if (input.reload && !bot.reloading && bot.reserve[bot.weapon] > 0) { bot.reloading = now + WEAPONS[bot.weapon].reload; room.events.push({ type: 'reload', id: bot.id }); }
          if (input.fire) fire(room, bot, input, tickTime);
          if (input.utility) throwEquipment(room, bot, input.utility, tickTime);
          interact(room, bot, input.interact);
        }
      }
      advanceEquipment(room, allPlayers(room), STEP * 1000, now); advanceRound(room, allPlayers(room), now);
      room.history.push(now, allPlayers(room));
      if (now < (room.nextBroadcast || 0)) continue;
      room.nextBroadcast = now + 1000 / SNAPSHOT_RATE;
      const snapshot: Snapshot = {
        type: 'state', time: now, code: room.code, mode: room.mode, map: room.map, players: allPlayers(room), environment: room.environment,
        phase: room.phase, endsAt: room.endsAt, score: room.score, winner: room.winner, bomb: room.bomb,
        buyEndsAt: room.buyEndsAt, matchWinner: room.matchWinner, round: room.round, matchComplete: room.matchComplete, matchDraw: room.matchDraw, winnerId: room.winnerId, hill: room.hill, gunGame: room.gunGame, difficulty: room.difficulty,
        projectiles: room.projectiles, drops: room.drops, visibility: room.visibility,
        smokes: room.smokes, fires: room.fires,
        events: room.events.splice(0, 200),
      };
      let rewarded = false;
      if (room.mode === 'ranked' && room.matchComplete && room.matchWinner && !room.rankedRecorded) {
        room.rankedRecorded = true;
        const ratings = new Map([...room.clients.values()].filter(client => client.accountId).map(client => [client.player.id, social.store.rankedProfile(client.accountId!).rating]));
        for (const client of room.clients.values()) if (client.accountId) {
          const opponents = [...room.clients.values()].filter(other => other.player.team !== client.player.team && other.accountId);
          const opponentRating = opponents.length ? opponents.reduce((sum, other) => sum + ratings.get(other.player.id)!, 0) / opponents.length : ratings.get(client.player.id)!;
          social.store.recordRankedResult(client.accountId, `ranked:${room.matchId}`, client.player.team === room.matchWinner, opponentRating, client.player.kills, client.player.deaths);
        }
        social.broadcast();
      }
      for (const client of room.clients.values()) if (client.accountId) {
        const amount = snapshot.events.filter(event => event.type === 'round' || event.id === client.player.id).reduce((total, event) => total + creditReward(room.mode, false, event, client.player.team), 0);
        if (amount) { social.store.award(client.accountId, amount); rewarded = true; }
      }
      if (rewarded) social.broadcast();
      for (const client of room.clients.values()) send(client.socket, snapshot);
    }
    }
  }, STEP * 500);
  const heartbeat = setInterval(() => {
    for (const room of rooms.values()) for (const client of room.clients.values()) {
      if (!client.alive) { client.socket.terminate(); continue; }
      client.alive = false; client.socket.ping();
    }
  }, 15000);

  http.listen(options.port ?? 3001, options.host ?? '0.0.0.0');
  return {
    http, rooms, social: social.store,
    close: async () => {
      closing = true;
      clearInterval(ticker); clearInterval(heartbeat);
      await social.close();
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>(resolve => sockets.close(() => resolve()));
      await new Promise<void>(resolve => http.close(() => resolve()));
    },
  };
}