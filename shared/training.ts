import { Ray, Vector3 } from 'three';
import { eyeHeight, simulateMovement, wallHit, walkable, type Difficulty, type Input, type MapId, type Player, type TrainingState } from './game.ts';
import { mapGeometry } from './map-geometry.ts';

export const TRAINING_DIFFICULTY = {
  easy: { lifetime: 5000, delay: 450, speed: 0, health: 45 },
  normal: { lifetime: 3000, delay: 300, speed: 0.34, health: 60 },
  hard: { lifetime: 1800, delay: 180, speed: 0.68, health: 80 },
} as const;

export const TRAINING_MAP: MapId = 'training';
export function createTraining(difficulty: Difficulty, now: number, kind: 'aim' | 'range' = 'aim'): TrainingState {
  return { difficulty, kind, range: kind === 'range' ? { distance: 30, moving: false, armor: false, health: 10000, lastDamage: 0 } : undefined, endsAt: kind === 'range' ? Number.MAX_SAFE_INTEGER : now + 60000, shots: 0, hits: 0, kills: 0, score: 0, streak: 0, bestStreak: 0,
    reactionTotal: 0, responses: 0, targetId: null, visibleSince: 0, availableAt: now, complete: false };
}

export function configureRange(state: TrainingState, options: Record<string, unknown>, now: number) {
  if (state.kind !== 'range' || !state.range) return false;
  if (typeof options.distance === 'number' && [10, 20, 30, 40].includes(options.distance)) state.range.distance = options.distance;
  if (typeof options.moving === 'boolean') state.range.moving = options.moving;
  if (typeof options.armor === 'boolean') state.range.armor = options.armor;
  if (typeof options.health === 'number' && [100, 200, 10000].includes(options.health)) state.range.health = options.health;
  state.targetId = null; state.availableAt = now; state.range.lastDamage = 0;
  return true;
}

export function recordTrainingShot(state: TrainingState, hit: boolean, killed: boolean, now: number) {
  if (state.complete || now >= state.endsAt) return;
  state.shots++;
  if (!hit) { state.streak = 0; return; }
  state.hits++; state.score += 15;
  if (killed) {
    state.kills++; state.streak++; state.bestStreak = Math.max(state.bestStreak, state.streak); state.score += 100 + state.streak * 10;
    state.reactionTotal += Math.max(0, now - state.visibleSince); state.responses++;
    state.targetId = null; state.availableAt = now + TRAINING_DIFFICULTY[state.difficulty].delay;
  }
}

export function advanceTraining(state: TrainingState, player: Player, targets: Player[], map: MapId, now: number) {
  if (now >= state.endsAt || state.complete) { state.complete = true; targets.forEach(target => { target.hp = 0; target.respawnAt = 0; }); return; }
  const settings = TRAINING_DIFFICULTY[state.difficulty];
  const active = targets.find(target => target.id === state.targetId && target.hp > 0);
    if (state.kind === 'range' && state.range) {
      const target = active || targets[0]; if (!target) return;
      if (!active) { target.hp = state.range.health; target.armor = state.range.armor ? 100 : 0; state.visibleSince = now; state.targetId = target.id; }
      Object.assign(target, { x: state.range.moving ? Math.sin((now - state.visibleSince) / 650) * 3 : 0, y: 0, z: 16 - state.range.distance, crouch: false, grounded: true, vy: 0, respawnAt: 0, weapon: 'knife' });
      target.yaw = Math.PI; return;
    }
  if (active && state.kind !== 'range' && now - state.visibleSince >= settings.lifetime) {
    active.hp = 0; state.targetId = null; state.streak = 0; state.availableAt = now + settings.delay; return;
  }
  if (active) {
    if (state.kind === 'range') return;
    const input: Input = { seq: Math.floor(now), time: now, forward: 0, side: Math.sin((now - state.visibleSince) / 450) * settings.speed,
      yaw: Math.atan2(active.x - player.x, active.z - player.z), pitch: 0, jump: false, crouch: state.difficulty === 'hard' && Math.sin(now / 700) < -0.8,
      sprint: false, fire: false, reload: false, scope: false, interact: false, weapon: 'knife' };
    for (let step = 0; step < 3; step++) simulateMovement(active, input, false, map);
    return;
  }
  if (now < state.availableAt || !targets.length) return;
  const origin = new Vector3(player.x, player.y + eyeHeight(player.crouch), player.z);
  const points = mapGeometry(map)?.metadata.navigation || Array.from({ length: 121 }, (_, index) => ({ x: player.x + (index % 11 - 5) * 4, y: 0, z: player.z + (Math.floor(index / 11) - 5) * 4 })).filter(point => walkable(point.x, point.z, map, 0.6));
  const stride = Math.max(1, Math.floor(points.length / 600)); const candidates = [];
  for (let index = 0; index < points.length; index += stride) {
    const point = points[index]; const distance = Math.hypot(point.x - player.x, point.z - player.z);
    if (distance < 6 || distance > 26 || Math.abs(point.y - player.y) > 3) continue;
    if (map === TRAINING_MAP && (point.z > player.z - 5 || Math.abs(point.x) > 20 || point.z < -24)) continue;
    const target = new Vector3(point.x, point.y + 1.1, point.z); const range = origin.distanceTo(target);
    if (wallHit(new Ray(origin, target.sub(origin).normalize()), range, map) >= range - 0.15) candidates.push(point);
  }
  if (!candidates.length) { state.availableAt = now + 250; return; }
  const index = (state.kills * 71 + state.shots * 13 + Math.floor(now / 700)) % candidates.length;
  const target = targets[0]; Object.assign(target, state.kind === 'range' ? { x: 0, y: 0, z: -18 } : candidates[index], { hp: state.kind === 'range' ? 10000 : settings.health, armor: 0, grounded: true, vy: 0, crouch: false, respawnAt: 0, weapon: 'knife' });
  target.yaw = Math.atan2(target.x - player.x, target.z - player.z); state.targetId = target.id; state.visibleSince = now;
}