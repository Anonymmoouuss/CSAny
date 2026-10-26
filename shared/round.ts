import { DoubleSide, Ray, Vector3 } from 'three';
import { mapGeometry } from './map-geometry.ts';
import { getSites, hasRespawns, spawn, spawnPoints, loadoutSlot, wallHit, WEAPONS, THROWABLES, type GameEvent, type Player, type Snapshot, type Team, type EnvironmentState, type WeaponId, type ThrowableId } from './game.ts';
import { advanceObjectiveMode, gunGameKill, initializeObjectiveMode } from './modes.ts';

export type RoundState = Pick<Snapshot, 'phase' | 'mode' | 'map' | 'endsAt' | 'score' | 'winner' | 'bomb' | 'environment' | 'buyEndsAt' | 'matchWinner' | 'matchComplete' | 'matchDraw' | 'winnerId' | 'hill' | 'gunGame' | 'difficulty' | 'projectiles' | 'drops' | 'smokes' | 'fires'> & { round: number; events: GameEvent[]; killsAtStart?: Record<string, number>; lossStreak?: Record<Team, number> };
export const BUY_WINDOW = 25000;
export const FREEZE_TIME = 15000;
export function isBombRound(state: Pick<Snapshot, 'mode' | 'round'>) { return state.mode === 'ranked' || state.mode === 'defusal' && (state.round || 1) % 2 === 1; }
export function matchLineup(players: Player[], winner?: Team, winnerId?: string) {
  return players.filter(player => !winner || player.team === winner).sort((first, second) => Number(second.id === winnerId) - Number(first.id === winnerId) || second.kills - first.kills || first.deaths - second.deaths || first.id.localeCompare(second.id)).slice(0, 5).map((player, index) => ({ player, x: index ? (index % 2 ? -1 : 1) * Math.ceil(index / 2) * 1.35 : 0, z: index ? -Math.ceil(index / 2) * 0.85 : 0 }));
}
type EquipmentState = Pick<Snapshot, 'phase' | 'map' | 'buyEndsAt' | 'mode' | 'round' | 'drops'>;
export function dropWeapon(state: Pick<Snapshot, 'drops'>, player: Player, weapon: WeaponId, now: number) {
  if (weapon === 'knife' || !player.owned.includes(weapon)) return false;
  state.drops ||= [];
  state.drops.push({ id: `${player.id}:${weapon}:${now}`, weapon, ammo: player.ammo[weapon], reserve: player.reserve[weapon], appearance: player.cosmetics[weapon], x: player.x, y: player.y + 1.05, z: player.z, vx: -Math.sin(player.yaw) * 2, vy: 1.1, vz: -Math.cos(player.yaw) * 2, yaw: player.yaw, roll: 0.12, updatedAt: now, settled: false, availableAt: now + 500, expiresAt: now + 90000 });
  if (state.drops.length > 48) state.drops.shift();
  player.owned = player.owned.filter(owned => owned !== weapon);
  if (player.weapon === weapon) player.weapon = player.owned.find(owned => loadoutSlot(owned) === 'primary') || player.owned.find(owned => loadoutSlot(owned) === 'secondary') || 'knife';
  player.reloading = 0;
  return true;
}
export function pickupWeapon(state: EquipmentState, player: Player, now: number) {
  if (state.mode === 'gungame' || player.hp <= 0 || state.phase !== 'live' && state.phase !== 'buy') return false;
  const drop = state.drops?.find(item => item.availableAt <= now && item.expiresAt > now && Math.hypot(item.x - player.x, item.z - player.z) < 1.8 && Math.abs(item.y - player.y) < 1.5);
  if (!drop) return false;
  const origin = new Vector3(player.x, player.y + 1, player.z); const target = new Vector3(drop.x, drop.y + 0.2, drop.z); const distance = origin.distanceTo(target);
  if (wallHit(new Ray(origin, target.sub(origin).normalize()), distance, state.map) < distance - 0.1) return false;
  state.drops = state.drops!.filter(item => item !== drop);
  const replaced = player.owned.find(weapon => loadoutSlot(weapon) === loadoutSlot(drop.weapon));
  if (replaced) dropWeapon(state, player, replaced, now);
  player.owned.push(drop.weapon); player.weapon = drop.weapon; player.reloading = 0;
  player.ammo[drop.weapon] = drop.ammo; player.reserve[drop.weapon] = drop.reserve;
  if (drop.appearance) player.cosmetics[drop.weapon] = drop.appearance; else delete player.cosmetics[drop.weapon];
  return true;
}
export function canPurchase(state: Pick<Snapshot, 'phase' | 'map' | 'buyEndsAt'> & Partial<Pick<Snapshot, 'mode'>>, player: Player, now: number) {
  return state.mode !== 'gungame' && player.hp > 0 && state.phase !== 'over' && state.phase !== 'waiting' && now < (state.buyEndsAt || 0) &&
    spawnPoints(player.team, state.map).some(point => Math.hypot(player.x - point.x, player.z - point.z) <= 10 && Math.abs(player.y - point.y) < 2.5);
}
export function purchaseEquipment(state: EquipmentState, player: Player, item: string, now: number) {
  if (state.mode === 'gungame') return 'GUN GAME LOADOUTS ADVANCE THROUGH KILLS';
  if (!canPurchase(state, player, now)) return 'PURCHASES REQUIRE YOUR SPAWN AREA AND AN ACTIVE SUPPLY TIMER';
  const weapon = Object.hasOwn(WEAPONS, item) ? item as WeaponId : null;
  const throwable = Object.hasOwn(THROWABLES, item) ? item as ThrowableId : null;
  const price = item === 'armor' ? 650 : item === 'kit' ? 400 : throwable ? THROWABLES[throwable].price : weapon ? WEAPONS[weapon].price : undefined;
  if (price === undefined) return 'UNKNOWN EQUIPMENT';
  if (player.money < price) return 'INSUFFICIENT MATCH SUPPLY';
  if (throwable) { if (player.grenades[throwable] >= THROWABLES[throwable].limit || Object.values(player.grenades).reduce((total, count) => total + count, 0) >= 3) return 'EQUIPMENT LIMIT REACHED'; player.grenades[throwable]++; }
  else if (item === 'armor') { if (player.armor >= 100) return 'ALREADY EQUIPPED'; player.armor = 100; }
  else if (item === 'kit') { if (!isBombRound(state) || player.kit || player.team !== 'CT') return 'DEFUSAL COUNTER-TERRORIST EQUIPMENT ONLY'; player.kit = true; }
  else if (weapon) {
    if (player.owned.includes(weapon)) return 'ALREADY EQUIPPED';
    const replaced = player.owned.find(owned => loadoutSlot(owned) === loadoutSlot(weapon));
    if (replaced) dropWeapon(state, player, replaced, now);
    player.owned.push(weapon); player.weapon = weapon; player.reloading = 0;
    player.ammo[weapon] = WEAPONS[weapon].capacity; player.reserve[weapon] = WEAPONS[weapon].capacity * 3;
  }
  player.money -= price; return null;
}
export const emptyBomb = (): Snapshot['bomb'] => ({ planted: false, position: null, endsAt: 0, progress: 0, actor: null, carrier: null, anchor: null, lastActive: 0 });
export const environmentForRound = (round: number): EnvironmentState => ({
  time: (['day', 'dusk', 'night', 'dawn'] as const)[Math.floor(Math.max(0, round - 1) / 2) % 4],
  weather: (['clear', 'overcast', 'rain', 'fog'] as const)[Math.floor(Math.max(0, round - 1) / 2) % 4],
});

export function finishRound(state: RoundState, players: Player[], winner: Team, now: number) {
  if (state.phase === 'over') return;
  state.phase = 'over'; state.winner = winner; state.endsAt = now + 5000; state.score[winner]++;
  if (state.mode === 'elimination' && state.score[winner] >= 5) { state.matchWinner = winner; state.endsAt = 0; }
  if (state.mode === 'ranked' && state.score[winner] >= 5 || state.mode === 'duel' && state.score[winner] >= 3) { state.matchWinner = winner; state.matchComplete = true; state.endsAt = 0; }
  if (state.mode === 'defusal' && state.round >= 4) {
    state.matchComplete = true; state.matchDraw = state.score.CT === state.score.T;
    state.matchWinner = state.matchDraw ? undefined : state.score.CT > state.score.T ? 'CT' : 'T'; state.endsAt = 0;
  }
  const mvp = players.filter(player => player.team === winner).sort((first, second) =>
    (second.kills - (state.killsAtStart?.[second.id] || 0)) - (first.kills - (state.killsAtStart?.[first.id] || 0)))[0];
  state.events.push({ type: 'round', team: winner, id: mvp?.id, text: mvp?.name });
  state.bomb.actor = null; state.bomb.progress = 0;
  state.lossStreak ||= { T: 0, CT: 0 };
  state.lossStreak[winner] = 0;
  const loser: Team = winner === 'T' ? 'CT' : 'T'; state.lossStreak[loser] = Math.min(5, state.lossStreak[loser] + 1);
  for (const player of players) player.money = Math.min(16000, player.money + (player.team === winner ? 3250 : 1400 + (state.lossStreak[loser] - 1) * 500));
}

export function recordModeKill(state: RoundState, players: Player[], killer: Player, weapon: WeaponId, now: number) {
  if (state.phase !== 'live' || !gunGameKill(state, killer, weapon)) return;
  finishRound(state, players, killer.team, now); state.winnerId = killer.id; state.matchWinner = killer.team; state.matchComplete = true; state.endsAt = 0;
}

export function beginRound(state: RoundState, players: Player[], now: number, random = Math.random) {
  state.round++; state.winner = undefined; state.matchWinner = undefined; state.bomb = emptyBomb(); state.projectiles = []; state.drops = []; state.smokes = []; state.fires = [];
  state.matchComplete = false; state.matchDraw = false;
  state.winnerId = undefined;
  state.environment = environmentForRound(state.round);
  state.phase = hasRespawns(state.mode) || state.mode === 'training' ? 'live' : 'buy';
  state.endsAt = now + (state.phase === 'buy' ? FREEZE_TIME : 300000); state.buyEndsAt = now + BUY_WINDOW;
  state.killsAtStart = Object.fromEntries(players.map(player => [player.id, player.kills]));
  const averages = Object.fromEntries((['CT', 'T'] as const).map(team => { const members = players.filter(player => player.team === team); return [team, members.reduce((total, player) => total + player.money, 0) / Math.max(1, members.length)]; })) as Record<Team, number>;
  for (const [index, player] of players.entries()) {
    if (state.mode !== 'deathmatch' && player.hp <= 0) { player.owned = ['pistol', 'knife']; player.weapon = 'pistol'; player.armor = 0; player.kit = false; }
    spawn(player, index + state.round * 3, state.map, state.mode === 'gungame' ? players.slice(0, index) : players, state.mode === 'gungame', state.mode === 'gungame');
    if (state.mode === 'deathmatch') player.armor = 100;
    if (player.id.startsWith('bot-') && state.mode !== 'training') {
      const plan = averages[player.team] >= 4200 ? 'fullBuy' : averages[player.team] >= 2000 ? 'forceBuy' : 'fullEco';
      const primary: WeaponId = plan === 'forceBuy' ? 'smg' : (['rifle', 'carbine', 'smg'] as const)[index % 3];
      if (plan !== 'fullEco') {
        if (!player.owned.some(weapon => loadoutSlot(weapon) === 'primary') && player.money >= WEAPONS[primary].price) purchaseEquipment(state, player, primary, now);
        if (player.armor < 100 && player.money >= 650) purchaseEquipment(state, player, 'armor', now);
        if (index % 3 === 1 && player.money >= 300) { purchaseEquipment(state, player, 'flashbang', now); if (player.money >= 300) purchaseEquipment(state, player, 'smoke', now); }
        if (isBombRound(state) && player.team === 'CT' && !player.kit && player.money >= 400) purchaseEquipment(state, player, 'kit', now);
      }
    }
  }
  const terrorists = players.filter(player => player.team === 'T');
  if (isBombRound(state) && terrorists.length) state.bomb.carrier = terrorists[Math.min(terrorists.length - 1, Math.floor(random() * terrorists.length))].id;
  initializeObjectiveMode(state, players, now);
}

export function dropBomb(state: RoundState, player: Player) {
  if (state.bomb.carrier !== player.id || state.bomb.planted) return;
  state.bomb.carrier = null; state.bomb.position = { x: player.x, y: player.y, z: player.z };
  state.bomb.actor = null; state.bomb.progress = 0; state.bomb.anchor = null;
  state.events.push({ type: 'bomb', id: player.id, text: 'Bomb dropped' });
}

export function interactBomb(state: RoundState, player: Player, active: boolean, elapsed: number, now: number, players: Player[] = [player]) {
  const bomb = state.bomb;
  if (!isBombRound(state) || state.phase !== 'live') return;
  const nearBomb = bomb.position && Math.hypot(player.x - bomb.position.x, player.z - bomb.position.z) < 2.6 && Math.abs(player.y - bomb.position.y) < 1.8;
  if (!bomb.planted && !bomb.carrier && nearBomb && player.team === 'T' && player.hp > 0) {
    bomb.carrier = player.id; bomb.position = null; state.events.push({ type: 'bomb', id: player.id, text: 'Bomb recovered' });
  }
  const atSite = getSites(state.map).some(site => Math.hypot(player.x - site.x, player.z - site.z) < 4.5 && Math.abs(player.y - site.y) < 1.8);
  const anchorValid = !bomb.anchor || Math.hypot(player.x - bomb.anchor.x, player.z - bomb.anchor.z, player.y - bomb.anchor.y) < 0.3;
  const valid = active && player.hp > 0 && player.grounded && !player.reloading && anchorValid && (bomb.planted ? player.team === 'CT' && nearBomb && now < bomb.endsAt : bomb.carrier === player.id && atSite);
  if (!valid) {
    if (bomb.actor === player.id) { bomb.actor = null; bomb.progress = 0; bomb.anchor = null; }
    return;
  }
  if (bomb.actor && bomb.actor !== player.id) return;
  if (!bomb.actor) { bomb.actor = player.id; bomb.anchor = { x: player.x, y: player.y, z: player.z }; }
  bomb.lastActive = now; bomb.progress += Math.min(50, elapsed) / (bomb.planted ? player.kit ? 5000 : 10000 : 3500);
  if (bomb.progress < 1 - 1e-9) return;
  if (bomb.planted) {
    state.events.push({ type: 'bomb', id: player.id, text: 'Bomb defused' });
    bomb.planted = false; bomb.position = null; bomb.endsAt = 0;
    player.money = Math.min(16000, player.money + 300); finishRound(state, players, 'CT', now);
  } else {
    bomb.planted = true; bomb.position = { x: player.x, y: player.y, z: player.z }; bomb.endsAt = now + 40000; bomb.carrier = null;
    state.events.push({ type: 'bomb', id: player.id, text: 'Bomb planted' }); player.money = Math.min(16000, player.money + 300);
  }
  bomb.progress = 0; bomb.actor = null; bomb.anchor = null;
}

export function advanceRound(state: RoundState, players: Player[], now: number) {
  if (state.drops) state.drops = state.drops.filter(drop => drop.expiresAt > now);
  for (const drop of state.drops || []) {
    if (drop.settled || drop.updatedAt === undefined) continue;
    const elapsed = Math.max(0, Math.min(0.05, (now - drop.updatedAt) / 1000)); drop.updatedAt = now;
    if (!elapsed) continue;
    const position = new Vector3(drop.x, drop.y, drop.z); const velocity = new Vector3(drop.vx || 0, (drop.vy || 0) - elapsed * 9.8, drop.vz || 0);
    const distance = velocity.length() * elapsed; const ray = new Ray(position, velocity.clone().normalize());
    const collision = wallHit(ray, distance + 0.06, state.map);
    if (collision < distance + 0.06) {
      const hit = mapGeometry(state.map)?.bvh.raycastFirst(ray, DoubleSide, 0, distance + 0.06);
      const normal = hit?.face?.normal.clone() || (ray.at(collision, new Vector3()).y < 0.12 ? new Vector3(0, 1, 0) : new Vector3(-velocity.x, 0, -velocity.z).normalize());
      if (normal.dot(velocity) > 0) normal.negate();
      position.addScaledVector(ray.direction, Math.max(0, collision - 0.065)); velocity.reflect(normal).multiplyScalar(0.22);
      if (normal.y > 0.65 && velocity.lengthSq() < 0.6) { velocity.set(0, 0, 0); drop.settled = true; }
    } else position.addScaledVector(velocity, elapsed);
    Object.assign(drop, { x: position.x, y: position.y, z: position.z, vx: velocity.x, vy: velocity.y, vz: velocity.z, roll: Math.min(Math.PI / 2, (drop.roll || 0) + elapsed * 4) });
  }
  if (state.phase === 'waiting') return;
  if (state.phase === 'over') { if (!state.matchWinner && !state.matchComplete && now >= state.endsAt) beginRound(state, players, now); return; }
  if (state.phase === 'buy') { if (now >= state.endsAt) { state.phase = 'live'; state.endsAt = now + 115000; } return; }
  if (state.mode === 'hill' || state.mode === 'gungame') {
    const outcome = advanceObjectiveMode(state, players, now);
    if (outcome) { finishRound(state, players, outcome.team, now); state.matchWinner = outcome.team; state.matchComplete = true; state.winnerId = outcome.player; state.endsAt = 0; }
    return;
  }
  const bomb = state.bomb;
  const carrier = players.find(player => player.id === bomb.carrier);
  if (carrier && carrier.hp <= 0) dropBomb(state, carrier);
  if (bomb.actor && (now - (bomb.lastActive || 0) > 180 || !players.some(player => player.id === bomb.actor && player.hp > 0))) { bomb.actor = null; bomb.progress = 0; bomb.anchor = null; }
  if (state.mode === 'deathmatch' || state.mode === 'training') {
    if (now >= state.endsAt) {
      const scores = { T: 0, CT: 0 }; players.forEach(player => scores[player.team] += player.kills - (state.killsAtStart?.[player.id] || 0));
      finishRound(state, players, scores.T > scores.CT ? 'T' : 'CT', now);
    }
    return;
  }
  const alive = players.filter(player => player.hp > 0);
  if (bomb.planted && now >= bomb.endsAt) {
    state.events.push({ type: 'bomb', text: 'Bomb exploded', point: bomb.position || undefined });
    for (const player of alive) {
      const distance = bomb.position ? Math.hypot(player.x - bomb.position.x, player.y - bomb.position.y, player.z - bomb.position.z) : 100;
      const damage = Math.max(0, Math.round(450 * (1 - distance / 32))) * (player.armor ? 0.7 : 1);
      player.hp = Math.max(0, player.hp - Math.round(damage));
      if (!player.hp) { player.deaths++; state.events.push({ type: 'kill', target: player.id }); }
    }
    bomb.planted = false; finishRound(state, players, 'T', now);
  } else if (!alive.some(player => player.team === 'CT')) finishRound(state, players, 'T', now);
  else if (!bomb.planted && (!alive.some(player => player.team === 'T') || now >= state.endsAt)) finishRound(state, players, 'CT', now);
}