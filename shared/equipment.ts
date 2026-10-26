import { DoubleSide, Ray, Vector3 } from 'three';
import { direction, eyeHeight, wallHit, THROWABLES, type GameEvent, type Player, type Projectile, type Snapshot, type SmokeVolume, type ThrowableId, type Vec, type MapId } from './game.ts';
import { mapGeometry } from './map-geometry.ts';
import { dropBomb, dropWeapon } from './round.ts';

type EquipmentState = Pick<Snapshot, 'mode' | 'phase' | 'map' | 'projectiles' | 'smokes' | 'fires' | 'drops' | 'bomb'> & { events: GameEvent[] };

export function flashExposure(player: Player, point: Vec, map: MapId) {
  const eye = new Vector3(player.x, player.y + eyeHeight(player.crouch), player.z); const origin = new Vector3(point.x, point.y, point.z);
  const distance = eye.distanceTo(origin); const aim = origin.clone().sub(eye).normalize();
  if (distance >= THROWABLES.flashbang.radius || wallHit(new Ray(eye, aim), distance, map) < distance - 0.16) return { strength: 0, hold: 0, duration: 0 };
  const facing = direction(player.yaw, player.pitch).dot(aim);
  const angle = 0.16 + Math.max(0, Math.min(1, (facing + 0.1) / 0.85)) * 0.84;
  const strength = distance < 10 && facing > 0.45 ? 1 : Math.pow(Math.max(0, 1 - distance / THROWABLES.flashbang.radius), 0.45) * angle;
  const hold = 450 + strength * 1350; return { strength, hold, duration: hold + 900 + strength * 3200 };
}

export function flashPresentation(player: Pick<Player, 'flashStrength' | 'flashHoldUntil' | 'flashedUntil'>, now: number, reduced = false) {
  const strength = Math.max(0, Math.min(1, player.flashStrength));
  if (now >= player.flashedUntil || !strength) return { opacity: 0, recovery: 0, muffle: 0 };
  const remaining = Math.max(0, Math.min(1, (player.flashedUntil - now) / Math.max(1, player.flashedUntil - player.flashHoldUntil)));
  const opacity = strength * (now < player.flashHoldUntil ? 1 : Math.pow(remaining, 1.6));
  return { opacity: reduced ? Math.min(0.35, opacity) : opacity, recovery: reduced || now < player.flashHoldUntil ? 0 : Math.sin(remaining * Math.PI) * strength, muffle: Math.max(opacity, remaining * strength * 0.8) };
}

function segmentDistance(point: Vec, from: Vec, to: Vec) {
  const length = (to.x - from.x) ** 2 + (to.y - from.y) ** 2 + (to.z - from.z) ** 2;
  const blend = length ? Math.max(0, Math.min(1, ((point.x - from.x) * (to.x - from.x) + (point.y - from.y) * (to.y - from.y) + (point.z - from.z) * (to.z - from.z)) / length)) : 0;
  return Math.hypot(point.x - from.x - (to.x - from.x) * blend, point.y - from.y - (to.y - from.y) * blend, point.z - from.z - (to.z - from.z) * blend);
}
export function createSmokeVolume(map: MapId, point: Vec, now: number, id: string): SmokeVolume {
  const start = { x: Math.floor(point.x) + 0.5, y: Math.floor(point.y) + 0.5, z: Math.floor(point.z) + 0.5 };
  const cells = [start]; const seen = new Set([`${start.x}:${start.y}:${start.z}`]);
  for (let index = 0; index < cells.length && cells.length < 512; index++) for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const current = cells[index]; const next = { x: current.x + dx, y: current.y + dy, z: current.z + dz }; const key = `${next.x}:${next.y}:${next.z}`;
    if (seen.has(key) || Math.hypot(next.x - point.x, next.y - point.y, next.z - point.z) > 4) continue;
    seen.add(key);
    if (wallHit(new Ray(new Vector3(current.x, current.y, current.z), new Vector3(dx, dy, dz)), 1, map) >= 0.99) cells.push(next);
  }
  return { ...point, id, cells, holes: [], expiresAt: now + 18000 };
}
export function cutSmoke(state: Pick<Snapshot, 'smokes'>, from: Vec, to: Vec, now: number, radius = 0.22, duration = 350) {
  for (const cloud of state.smokes || []) if (segmentDistance(cloud, from, to) < 4.5 + radius) {
    cloud.holes = cloud.holes.filter(hole => hole.until > now).slice(-47);
    cloud.holes.push({ from: { x: from.x, y: from.y, z: from.z }, to: { x: to.x, y: to.y, z: to.z }, radius, until: now + duration });
  }
}
export function smokeCellVisible(cloud: SmokeVolume, cell: Vec, now: number) { return !cloud.holes.some(hole => hole.until > now && segmentDistance(cell, hole.from, hole.to) <= hole.radius + 0.65); }
export function smokeBlocks(state: Pick<Snapshot, 'smokes'>, from: Vec, to: Vec, now: number) {
  for (const cloud of state.smokes || []) {
    if (cloud.expiresAt <= now || segmentDistance(cloud, from, to) > 4.7) continue;
    let crossed = 0;
    for (const cell of cloud.cells) if (segmentDistance(cell, from, to) < 0.75 && smokeCellVisible(cloud, cell, now) && ++crossed >= 2) return true;
  }
  return false;
}

export function throwEquipment(state: EquipmentState, player: Player, kind: ThrowableId, now: number) {
  if (state.phase !== 'live' || player.hp <= 0 || player.reloading || now - player.lastThrow < 650 || player.grenades[kind] <= 0) return false;
  const aim = direction(player.yaw, Math.min(1.45, player.pitch + 0.1));
  const origin = new Vector3(player.x, player.y + eyeHeight(player.crouch) - 0.1, player.z);
  const clearance = wallHit(new Ray(origin, aim), 0.4, state.map);
  origin.addScaledVector(aim, Math.max(0, clearance - 0.08));
  player.grenades[kind]--; player.lastThrow = now;
  (state.projectiles ||= []).push({ id: `${player.id}-${now}-${kind}`, owner: player.id, team: player.team, kind,
    x: origin.x, y: origin.y, z: origin.z, vx: aim.x * 13, vy: aim.y * 13 + 2.8, vz: aim.z * 13, fuseAt: now + THROWABLES[kind].fuse });
  state.events.push({ type: 'throw', id: player.id, equipment: kind, point: origin }); return true;
}

function detonate(state: EquipmentState, projectile: Projectile, players: Player[], now: number) {
  const point = new Vector3(projectile.x, projectile.y + 0.12, projectile.z);
  const definition = THROWABLES[projectile.kind]; const owner = players.find(player => player.id === projectile.owner);
  if (projectile.kind === 'smoke') {
    (state.smokes ||= []).push(createSmokeVolume(state.map, point, now, projectile.id)); if (state.smokes.length > 8) state.smokes.shift();
    state.events.push({ type: 'explosion', id: projectile.owner, equipment: 'smoke', point }); return;
  }
  if (projectile.kind === 'molotov') {
    const cells: Vec[] = [];
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      if (Math.hypot(dx, dz) > 3.2) continue;
      const origin = new Vector3(point.x + dx * 1.15, point.y + 2, point.z + dz * 1.15); const depth = wallHit(new Ray(origin, new Vector3(0, -1, 0)), 5, state.map);
      if (depth >= 5 || Math.abs(origin.y - depth - point.y) > 1.2) continue;
      const next = new Vector3(origin.x, origin.y - depth + 0.04, origin.z); const range = point.distanceTo(next);
      if (wallHit(new Ray(point.clone().add(new Vector3(0, 0.3, 0)), next.clone().add(new Vector3(0, 0.3, 0)).sub(point.clone().add(new Vector3(0, 0.3, 0))).normalize()), range, state.map) >= range - 0.1) cells.push(next);
    }
    (state.fires ||= []).push({ ...point, id: projectile.id, owner: projectile.owner, team: projectile.team, cells, expiresAt: now + 7000, nextDamageAt: now }); if (state.fires.length > 8) state.fires.shift();
    state.events.push({ type: 'explosion', id: projectile.owner, equipment: 'molotov', point }); return;
  }
  if (projectile.kind === 'grenade') cutSmoke(state, point, point, now, 3, 2500);
  state.events.push({ type: projectile.kind === 'grenade' ? 'explosion' : 'flash', id: projectile.owner, equipment: projectile.kind, point });
  for (const player of players) {
    if (player.hp <= 0) continue;
    const target = new Vector3(player.x, player.y + (projectile.kind === 'flashbang' ? eyeHeight(player.crouch) : 0.9), player.z);
    const distance = point.distanceTo(target); if (distance >= definition.radius) continue;
    const ray = new Ray(point, target.clone().sub(point).normalize());
    if (wallHit(ray, distance, state.map) < distance - 0.16) continue;
    if (projectile.kind === 'flashbang') {
      const exposure = flashExposure(player, point, state.map); if (!exposure.strength) continue;
      const current = flashPresentation(player, now);
      player.flashStrength = Math.max(current.opacity, exposure.strength);
      player.flashHoldUntil = Math.max(player.flashHoldUntil, now + exposure.hold);
      player.flashedUntil = Math.max(player.flashedUntil, now + exposure.duration);
      continue;
    }
    if (player.team === projectile.team && player.id !== projectile.owner) continue;
    const raw = 115 * (1 - distance / definition.radius); const absorbed = Math.min(player.armor, raw * 0.25);
    const damage = Math.round(raw - absorbed); player.armor = Math.max(0, player.armor - absorbed); player.hp = Math.max(0, player.hp - damage);
    state.events.push({ type: 'hit', id: projectile.owner, target: player.id, damage, origin: point, equipment: projectile.kind });
    if (!player.hp) {
      player.deaths++; player.respawnAt = state.mode === 'deathmatch' ? now + 1100 : state.mode === 'training' ? now + 500 : 0;
      if (owner && owner.id !== player.id) { owner.kills++; owner.money = Math.min(16000, owner.money + 300); }
      state.events.push({ type: 'kill', id: projectile.owner, target: player.id, equipment: projectile.kind });
      dropBomb({ ...state, round: 0, endsAt: 0, score: { CT: 0, T: 0 } }, player);
      for (const weapon of [...player.owned]) dropWeapon(state, player, weapon, now);
    }
  }
}

export function advanceEquipment(state: EquipmentState, players: Player[], elapsed: number, now: number) {
  if (state.phase !== 'live') { state.projectiles = []; return; }
  state.smokes = state.smokes?.filter(cloud => cloud.expiresAt > now);
  for (const cloud of state.smokes || []) cloud.holes = cloud.holes.filter(hole => hole.until > now);
  state.fires = state.fires?.filter(fire => fire.expiresAt > now);
  for (const fire of state.fires || []) if (now >= fire.nextDamageAt) {
    fire.nextDamageAt = now + 100;
    for (const player of players) {
      if (player.hp <= 0 || player.team === fire.team && player.id !== fire.owner || !fire.cells.some(cell => Math.hypot(cell.x - player.x, cell.z - player.z) < 0.85 && Math.abs(cell.y - player.y) < 1.5)) continue;
      player.hp = Math.max(0, player.hp - 4); state.events.push({ type: 'hit', id: fire.owner, target: player.id, damage: 4, origin: fire, equipment: 'molotov' });
      if (!player.hp) {
        player.deaths++; player.respawnAt = state.mode === 'deathmatch' ? now + 1100 : 0;
        const owner = players.find(owner => owner.id === fire.owner); if (owner && owner.id !== player.id) { owner.kills++; owner.money = Math.min(16000, owner.money + 300); }
        state.events.push({ type: 'kill', id: fire.owner, target: player.id, equipment: 'molotov' });
        for (const weapon of [...player.owned]) dropWeapon(state, player, weapon, now);
      }
    }
  }
  const steps = Math.max(1, Math.ceil(Math.min(100, Math.max(0, elapsed)) / (1000 / 60))); const dt = Math.min(0.1, Math.max(0, elapsed) / 1000) / steps;
  const remaining: Projectile[] = [];
  for (const projectile of state.projectiles || []) {
    for (let step = 0; step < steps; step++) {
      projectile.vy -= 12 * dt;
      const origin = new Vector3(projectile.x, projectile.y, projectile.z); const velocity = new Vector3(projectile.vx, projectile.vy, projectile.vz);
      const travel = velocity.length() * dt; if (travel < 1e-6) continue;
      const ray = new Ray(origin, velocity.clone().normalize()); const distance = wallHit(ray, travel + 0.07, state.map);
      if (distance < travel + 0.07) {
        const hit = mapGeometry(state.map)?.bvh.raycastFirst(ray, DoubleSide, 0, travel + 0.07);
        const normal = hit?.face?.normal.clone() || (ray.at(distance, new Vector3()).y < 0.12 ? new Vector3(0, 1, 0) : ray.direction.clone().negate());
        if (normal.dot(velocity) > 0) normal.negate();
        origin.addScaledVector(ray.direction, Math.max(0, distance - 0.075)); velocity.reflect(normal).multiplyScalar(0.52);
        if (normal.y > 0.6 && Math.abs(velocity.y) < 0.8) { velocity.y = 0; velocity.x *= 0.7; velocity.z *= 0.7; }
      } else origin.addScaledVector(velocity, dt);
      Object.assign(projectile, { x: origin.x, y: origin.y, z: origin.z, vx: velocity.x, vy: velocity.y, vz: velocity.z });
    }
    if (now >= projectile.fuseAt) detonate(state, projectile, players, now); else remaining.push(projectile);
  }
  state.projectiles = remaining;
}