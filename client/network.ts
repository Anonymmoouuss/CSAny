import { Ray, Vector3 } from 'three';
import { createPlayer, equipPlayer, eyeHeight, hasRespawns, simulateMovement, spawn, STEP, WEAPONS, THROWABLES, type ThrowableId, type TrainingState, type Difficulty, type GameEvent, type Input, type Mode, type MapId, type Player, type Snapshot, type WeaponId } from '../shared/game.ts';
import { encodeInputs } from '../shared/protocol.ts';
import type { SkinAppearance } from '../shared/economy.ts';
import type { SocialCredentials } from '../shared/social.ts';
import { emptyBomb, beginRound, advanceRound, dropBomb, dropWeapon, pickupWeapon, interactBomb, purchaseEquipment, recordModeKill, type RoundState } from '../shared/round.ts';
import { equipGunGame } from '../shared/modes.ts';
import { fireHitscan } from '../shared/combat.ts';
import { botInput, createBrain, type BotBrain } from '../shared/bots.ts';
import { advanceEquipment, throwEquipment } from '../shared/equipment.ts';
import { advanceTraining, configureRange, createTraining, recordTrainingShot, TRAINING_MAP } from '../shared/training.ts';

export function multiplayerAddress(address: string, origin: string, configured = '') {
  const value = configured.trim() || address.trim(); const page = new URL(origin);
  if (!value && page.hostname.endsWith('.vercel.app')) throw new Error('Online play is temporarily unavailable. Solo and training are still available.');
  const url = value ? new URL(value.startsWith('/') ? value : value.includes('://') ? value : `https://${value}`, page) : new URL('/ws', page);
  if (url.protocol === 'https:') url.protocol = 'wss:'; if (url.protocol === 'http:') url.protocol = 'ws:';
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw new Error('The game connection is unavailable.');
  if (url.pathname === '/' || !url.pathname) url.pathname = '/ws'; return url.toString();
}

const wakingServers = new Map<string, { ready: Promise<void>; expiresAt: number }>();
export function warmMultiplayerServer(address: string): Promise<void> {
  const url = new URL(address);
  if (!url.hostname.endsWith('.onrender.com')) return Promise.resolve();
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'; url.pathname = '/health'; url.search = ''; url.hash = '';
  const key = url.toString(); const previous = wakingServers.get(key);
  if (previous && previous.expiresAt > Date.now()) return previous.ready;
  const ready = Promise.resolve().then(() => fetch(key, { mode: 'no-cors', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(90000) })).then(response => {
    if (response.type !== 'opaque' && !response.ok) throw new Error('The free game server could not start. Please try again shortly.');
    const current = wakingServers.get(key); if (current) current.expiresAt = Date.now() + 60000;
  }).catch(() => { wakingServers.delete(key); throw new Error('The free game server is waking up or unavailable. Please try again shortly.'); });
  wakingServers.set(key, { ready, expiresAt: Infinity }); return ready;
}

export class Network {
  socket: WebSocket | null = null;
  id = '';
  code = '';
  ping = 0;
  offset = 0;
  state: Snapshot | null = null;
  predicted: Player | null = null;
  pending: Input[] = [];
  outgoing: Input[] = [];
  history: Snapshot[] = [];
  error = { x: 0, y: 0, z: 0 };
  onState: (snapshot: Snapshot) => void = () => {};
  onClose: () => void = () => {};
  onError: (text: string) => void = () => {};
  prepareMap: (map: MapId) => Promise<void> = async () => {};
  lastReceived = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private practiceTimer: ReturnType<typeof setInterval> | null = null;
  private practiceEnabled = false;
  private practiceMap: MapId = 'dustline';
  private practiceBots: Player[] = [];
  private practiceEvents: GameEvent[] = [];
  private practiceRound: RoundState | null = null;
  private brains = new Map<string, BotBrain>();
  private training: TrainingState | null = null;
  private purchaseWeapon: { id: WeaponId; until: number } | null = null;
  private practiceLastTick = 0;
  private practiceBudget = 0;

  startPractice(data: { name: string; mode?: Mode; difficulty?: Difficulty; trainingKind?: 'aim' | 'range'; map: MapId; skin: number; knifeStyle: number; owned: WeaponId[]; weapon: WeaponId; cosmetics?: Partial<Record<WeaponId, SkinAppearance>> }) {
    if (data.mode === 'training') data = { ...data, map: TRAINING_MAP };
    this.disconnect();
    this.practiceEnabled = true; this.practiceMap = data.map; this.id = 'offline-operator'; this.code = 'PRACTICE';
    const mode = data.mode || 'elimination';
    const player = createPlayer(this.id, data.name, 'CT', mode, 0);
    player.skin = data.skin; player.knifeStyle = data.knifeStyle;
    player.cosmetics = data.cosmetics || {};
    this.predicted = player;
    if (mode === 'training') { player.owned = Object.keys(WEAPONS) as WeaponId[]; player.weapon = data.weapon === 'knife' ? 'rifle' : data.weapon; player.armor = 100; }
    const names = mode === 'training' ? ['Target'] : ['Morrow', 'Rook', 'Switch', 'Cinder', 'North', 'Echo', 'Flint', 'Vale', 'Reed'];
    this.practiceBots = names.map((name, index) => {
      const bot = createPlayer(`bot-${index}`, name, index < 5 ? 'T' : 'CT', mode, index);
      if (mode === 'deathmatch') { bot.owned = Object.keys(WEAPONS) as WeaponId[]; bot.weapon = (['carbine', 'smg', 'shotgun', 'sniper', 'rifle'] as WeaponId[])[index % 5]; }
      bot.skin = (index + 3) % 12;
      bot.lastShot = Date.now() - 1200;
      this.brains.set(bot.id, createBrain(index));
      return bot;
    });
    this.practiceRound = { mode, difficulty: data.difficulty || 'normal', map: data.map, phase: 'waiting', endsAt: 0, score: { T: 0, CT: 0 }, bomb: emptyBomb(), events: this.practiceEvents, round: 0 };
    beginRound(this.practiceRound, [player, ...this.practiceBots], Date.now());
    if (mode === 'training') {
      this.training = createTraining(data.difficulty || 'normal', Date.now(), data.trainingKind); this.practiceRound.endsAt = this.training.endsAt;
      advanceTraining(this.training, player, this.practiceBots, data.map, Date.now());
      const target = this.practiceBots[0]; if (this.training.targetId) { player.yaw = Math.atan2(player.x - target.x, player.z - target.z); player.pitch = Math.atan2(target.y + 1.1 - player.y - eyeHeight(false), Math.hypot(target.x - player.x, target.z - player.z)); }
    }
    this.state = {
      ...this.practiceRound, type: 'state', time: Date.now(), code: this.code,
      players: [player, ...this.practiceBots], events: [], training: this.training || undefined,
    };
    this.history = [structuredClone(this.state)]; this.onState(this.state);
    this.practiceTimer = setInterval(() => this.stepPractice(), 50);
  }

  private shootPractice(shooter: Player, targets: Player[], input: Input, now: number) {
    if (this.practiceRound?.phase !== 'live') return;
    const shot = fireHitscan(shooter, targets, input, now, this.practiceMap, { mode: this.practiceRound.mode, unlimitedAmmo: !!this.training, utility: this.practiceRound });
    if (!shot) return;
    this.practiceEvents.push(...shot.events);
    if (this.training && shooter.id === this.id) recordTrainingShot(this.training, shot.hits > 0, shot.killed.length > 0, now);
      if (this.training?.range && shooter.id === this.id) this.training.range.lastDamage = shot.events.filter(event => event.type === 'hit').reduce((total, event) => total + (event.damage || 0), 0);
    for (const victim of shot.killed) {
      victim.respawnAt = hasRespawns(this.practiceRound.mode) ? now + 1100 : 0;
      dropBomb(this.practiceRound, victim);
      if (!this.training && this.practiceRound.mode !== 'gungame') for (const weapon of [...victim.owned]) dropWeapon(this.practiceRound, victim, weapon, now);
      recordModeKill(this.practiceRound, [this.predicted!, ...this.practiceBots], shooter, shot.events[0].weapon!, now);
    }
  }

  private stepPractice() {
    if (!this.practiceEnabled || !this.state || !this.predicted || !this.practiceRound) return;
    const now = Date.now(); const player = this.predicted;
    const elapsed = Math.min(100, this.practiceLastTick ? now - this.practiceLastTick : 50); this.practiceLastTick = now; this.practiceBudget += elapsed;
    const steps = Math.min(8, Math.floor(this.practiceBudget / (STEP * 1000))); this.practiceBudget -= steps * STEP * 1000;
    const all = [player, ...this.practiceBots];
    if (this.training) {
      advanceTraining(this.training, player, this.practiceBots, this.practiceMap, now);
      if (this.training.complete) { this.practiceRound.phase = 'over'; this.practiceRound.endsAt = 0; }
    } else advanceRound(this.practiceRound, all, now);
    for (const operator of all) {
      if (operator.respawnAt && now >= operator.respawnAt) { spawn(operator, operator.deaths, this.practiceMap, all, true, this.practiceRound.mode === 'gungame'); operator.armor = 100; if (this.practiceRound.gunGame) equipGunGame(operator, this.practiceRound.gunGame.levels[operator.id] || 0); }
      if (operator.reloading && now >= operator.reloading) {
        const amount = Math.min(WEAPONS[operator.weapon].capacity - operator.ammo[operator.weapon], operator.reserve[operator.weapon]);
        operator.ammo[operator.weapon] += amount; operator.reserve[operator.weapon] -= amount; operator.reloading = 0;
      }
    }
    for (const bot of this.training ? [] : this.practiceBots) {
      for (let step = 0; step < steps; step++) {
        const tickTime = now - (steps - 1 - step) * STEP * 1000;
        const move = botInput(bot, all, this.practiceRound, this.brains.get(bot.id)!, tickTime);
        simulateMovement(bot, move, this.practiceRound.phase !== 'live', this.practiceMap);
        if (move.reload && !bot.reloading && bot.reserve[bot.weapon] > 0) { bot.reloading = now + WEAPONS[bot.weapon].reload; this.practiceEvents.push({ type: 'reload', id: bot.id }); }
        if (move.fire) this.shootPractice(bot, all, move, tickTime);
        if (move.utility) throwEquipment(this.practiceRound, bot, move.utility, tickTime);
        interactBomb(this.practiceRound, bot, move.interact, STEP * 1000, now, all);
      }
    }
    advanceEquipment(this.practiceRound, all, elapsed, now); if (!this.training) advanceRound(this.practiceRound, all, now);
    const snapshot: Snapshot = {
      ...this.practiceRound, type: 'state', code: this.code, time: now, players: all.map(value => structuredClone(value)), events: this.practiceEvents.splice(0, 200), training: this.training ? { ...this.training } : undefined,
    };
    this.state = snapshot; this.history.push(snapshot); if (this.history.length > 12) this.history.shift();
    this.onState(snapshot);
  }

  connect(url: string, data: { name: string; code: string; mode: string; create: boolean; matchmaking?: boolean; account?: SocialCredentials; skin: number; map?: MapId; owned?: string[]; cosmetics?: Partial<Record<WeaponId, SkinAppearance>>; weapon?: WeaponId }) {
    this.disconnect();
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url); this.socket = socket;
      let welcomed = false;
      let connected = false;
      let queuedState: Snapshot | null = null;
      const timeout = setTimeout(() => { reject(new Error('Server timed out. Free hosts may need a minute to wake up. Try again.')); socket.close(); }, 20000);
      socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'join', ...data })));
      const receive = async (event: MessageEvent) => {
        if (this.socket !== socket) return;
        const message = JSON.parse(event.data);
        if (message.type === 'welcome') {
          try { await this.prepareMap(message.map); }
          catch (error) { clearTimeout(timeout); reject(error); socket.close(); return; }
          if (this.socket !== socket) return;
          this.id = message.id; this.code = message.code; welcomed = true;
          this.timer = setInterval(() => this.flush(), 50);
          this.pingTimer = setInterval(() => this.send({ type: 'ping', sent: Date.now() }), 2000);
          if (queuedState) { const state = queuedState; queuedState = null; await receive({ data: JSON.stringify(state) } as MessageEvent); }
        }
        if (message.type === 'error') {
          this.purchaseWeapon = null;
          if (!connected) { clearTimeout(timeout); reject(new Error(message.text)); socket.close(); }
          else this.onError(message.text);
        }
        if (message.type === 'pong') {
          this.ping = Math.round(Date.now() - message.sent);
          this.offset = message.time - (message.sent + Date.now()) / 2;
        }
        if (message.type === 'state') {
          if (!welcomed) { queuedState = message as Snapshot; return; }
          const snapshot = message as Snapshot;
          if (!this.state) this.offset = snapshot.time - Date.now();
          this.lastReceived = performance.now();
          const authoritative = snapshot.players.find(player => player.id === this.id);
          if (authoritative) {
            if (this.purchaseWeapon && (authoritative.weapon === this.purchaseWeapon.id || Date.now() > this.purchaseWeapon.until)) this.purchaseWeapon = null;
            const previous = this.predicted;
            this.pending = this.pending.filter(input => input.seq > authoritative.seq);
            this.predicted = structuredClone(authoritative);
            for (const input of this.pending) { equipPlayer(this.predicted, input.weapon); simulateMovement(this.predicted, input, snapshot.phase === 'buy' || snapshot.phase === 'over', snapshot.map); }
            if (previous) {
              const distance = Math.hypot(previous.x - this.predicted.x, previous.y - this.predicted.y, previous.z - this.predicted.z);
              if (distance < 2) {
                this.error.x += previous.x - this.predicted.x; this.error.y += previous.y - this.predicted.y; this.error.z += previous.z - this.predicted.z;
              } else this.error = { x: 0, y: 0, z: 0 };
            }
          }
          this.state = snapshot; this.history.push(snapshot);
          if (this.history.length > 12) this.history.shift();
          this.onState(snapshot);
          if (authoritative && !connected) { connected = true; clearTimeout(timeout); resolve(); }
        }
      };
      socket.addEventListener('message', event => { void receive(event).catch(() => { clearTimeout(timeout); reject(new Error('The game connection could not be initialized.')); socket.close(); }); });
      socket.addEventListener('error', () => {
        if (!connected) { clearTimeout(timeout); reject(new Error('Online play is temporarily unavailable. Please try again shortly.')); }
      });
      socket.addEventListener('close', () => {
        if (this.socket !== socket) return;
        clearTimeout(timeout); this.stopTimers();
        if (connected) this.onClose();
        else reject(new Error('Connection closed before a playable room state arrived.'));
      });
    });
  }

  send(data: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      const message = data as { type?: string; item?: string };
      if (message?.type === 'buy' && message.item && Object.hasOwn(WEAPONS, message.item)) { this.purchaseWeapon = { id: message.item as WeaponId, until: Date.now() + 1500 }; this.outgoing = []; this.pending = []; }
      this.socket.send(JSON.stringify(data)); return;
    }
    if (!this.practiceEnabled || !this.predicted || !this.state || !data || typeof data !== 'object') return;
    const message = data as Record<string, unknown>;
    if (message.type === 'cosmetics' && message.cosmetics && typeof message.cosmetics === 'object') this.predicted.cosmetics = message.cosmetics as Player['cosmetics'];
    if (message.type === 'skin' && Number.isInteger(message.skin)) this.predicted.skin = Math.max(0, Math.min(11, Number(message.skin)));
    if (message.type === 'knife' && Number.isInteger(message.style)) this.predicted.knifeStyle = Math.max(0, Math.min(49, Number(message.style)));
    if (message.type === 'throw' && typeof message.item === 'string' && Object.hasOwn(THROWABLES, message.item) && this.practiceRound) {
      if (!throwEquipment(this.practiceRound, this.predicted, message.item as ThrowableId, Date.now())) this.onError('THROWABLE UNAVAILABLE');
    }
    if (message.type === 'buy' && typeof message.item === 'string') {
      if (!this.practiceRound) return;
      const error = purchaseEquipment(this.practiceRound, this.predicted, message.item, Date.now());
      if (error) { this.onError(error); return; }
    }
    if (message.type === 'pickup' && this.practiceRound) pickupWeapon(this.practiceRound, this.predicted, Date.now());
    if (message.type === 'drop' && this.practiceRound && this.practiceRound.mode !== 'gungame' && this.predicted.hp > 0) dropWeapon(this.practiceRound, this.predicted, this.predicted.weapon, Date.now());
      if (message.type === 'range' && this.training && configureRange(this.training, message, Date.now())) advanceTraining(this.training, this.predicted, this.practiceBots, this.practiceMap, Date.now());
      if (message.type === 'chat' && typeof message.text === 'string') { const text = message.text.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 120); if (text) this.practiceEvents.push({ type: 'chat', id: this.id, text }); }
    this.state = { ...this.state, drops: this.practiceRound?.drops, time: Date.now(), players: [this.predicted, ...this.practiceBots].map(player => structuredClone(player)), events: [] };
    this.onState(this.state);
  }
  input(input: Input) {
    if (!this.predicted || !this.state) return;
    if (this.purchaseWeapon) input = { ...input, weapon: this.purchaseWeapon.id };
    equipPlayer(this.predicted, input.weapon);
    simulateMovement(this.predicted, input, this.state.phase === 'buy' || this.state.phase === 'over', this.state.map);
    if (this.practiceEnabled) {
      const player = this.predicted; const now = Date.now();
      if (player.hp > 0 && this.practiceRound?.phase === 'live') {
        if (input.reload && !player.reloading && player.weapon !== 'knife' && player.ammo[player.weapon] < WEAPONS[player.weapon].capacity && player.reserve[player.weapon] > 0) { player.reloading = now + WEAPONS[player.weapon].reload; this.practiceEvents.push({ type: 'reload', id: player.id }); }
        if (input.fire) this.shootPractice(player, this.practiceBots, input, now);
        interactBomb(this.practiceRound, player, input.interact, STEP * 1000, now, [player, ...this.practiceBots]);
      }
      return;
    }
    this.pending.push(input); this.outgoing.push(input);
    if (this.pending.length > 240) this.pending.splice(0, this.pending.length - 240);
    if (this.outgoing.length > 240) this.outgoing.splice(0, this.outgoing.length - 240);
  }
  flush() {
    if (!this.outgoing.length || this.socket?.readyState !== WebSocket.OPEN) return;
    const batch: Input[] = []; let firstTime = Infinity; let lastTime = -Infinity;
    while (this.outgoing.length && batch.length < 6) {
      const input = this.outgoing[0]; const first = Math.min(firstTime, input.time); const last = Math.max(lastTime, input.time);
      if (batch.length && last - Math.floor(first) > 1000) break;
      batch.push(this.outgoing.shift()!); firstTime = first; lastTime = last;
    }
    this.socket.send(encodeInputs(batch));
  }
  interpolated() {
    if (!this.state) return [];
    const time = Date.now() + this.offset - 100;
    let before = this.history[0]; let after = this.state;
    for (const snapshot of this.history) {
      if (snapshot.time <= time) before = snapshot;
      else { after = snapshot; break; }
    }
    const alpha = Math.max(0, Math.min(1, (time - before.time) / Math.max(1, after.time - before.time)));
    return after.players.map(player => {
      const previous = before.players.find(other => other.id === player.id);
      if (!previous || Math.hypot(player.x - previous.x, player.z - previous.z) > 4) return player;
      let deltaYaw = player.yaw - previous.yaw;
      deltaYaw = Math.atan2(Math.sin(deltaYaw), Math.cos(deltaYaw));
      return { ...player, x: previous.x + (player.x - previous.x) * alpha, y: previous.y + (player.y - previous.y) * alpha, z: previous.z + (player.z - previous.z) * alpha, yaw: previous.yaw + deltaYaw * alpha };
    });
  }
  private stopTimers() {
    if (this.timer) clearInterval(this.timer); if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.practiceTimer) clearInterval(this.practiceTimer);
  }
  disconnect() {
    this.practiceEnabled = false; this.practiceBots = []; this.practiceEvents = []; this.practiceRound = null; this.training = null; this.brains.clear();
    this.stopTimers(); const socket = this.socket; this.socket = null; socket?.close(); this.state = null; this.predicted = null;
    this.error = { x: 0, y: 0, z: 0 }; this.offset = 0;
    this.pending = []; this.outgoing = []; this.history = []; this.id = '';
    this.purchaseWeapon = null;
    this.practiceLastTick = 0; this.practiceBudget = 0;
  }
}