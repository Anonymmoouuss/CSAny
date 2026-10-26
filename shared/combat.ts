import { DoubleSide, Ray, Vector3 } from 'three';
import { damageAtRange, eyeHeight, getColliders, hitMelee, hitPlayer, MAPS, opposingPlayers, shotDirection, wallHit, WEAPONS, type GameEvent, type Input, type MapId, type Mode, type Player, type Snapshot, type WeaponId } from './game.ts';
import { mapGeometry, type SurfaceMaterial } from './map-geometry.ts';
import { cutSmoke } from './equipment.ts';

export type HitboxPose = Pick<Player, 'x' | 'y' | 'z' | 'crouch'> & Partial<Pick<Player, 'deaths'>>;
export type ShotOptions = { mode?: Mode; positions?: ReadonlyMap<string, HitboxPose>; utility?: Pick<Snapshot, 'smokes'>; unlimitedAmmo?: boolean; damageEnabled?: boolean; random?: () => number };
export const SURFACE_DENSITY: Record<SurfaceMaterial, number> = { wood: 0.8, drywall: 1.4, concrete: 6, steel: 10, glass: 0.4 };

export function traceBallisticPath(map: MapId, ray: Ray, weapon: WeaponId) {
  const definition = WEAPONS[weapon];
  const energy = definition.model === 'sniper' ? 5 : definition.model === 'rifle' || definition.model === 'lmg' ? 3 : definition.model === 'pistol' ? 1.2 : definition.model === 'smg' ? 1 : 0.3;
  const obstacles: { entry: number; exit: number; material: SurfaceMaterial }[] = [];
  const geometry = mapGeometry(map);
  if (geometry) {
    const hits = geometry.bvh.raycast(ray, DoubleSide, 0.001, definition.range).sort((first, second) => first.distance - second.distance).filter((hit, index, all) => !index || hit.distance - all[index - 1].distance > 0.003);
    for (let index = 0; index < hits.length; index++) {
      const hit = hits[index]; const surface = geometry.metadata.surfaces?.[geometry.metadata.triangleSurfaces?.[hit.faceIndex!] ?? -1] || 'concrete';
      const next = hits[index + 1]; const closed = next && hit.face!.normal.dot(ray.direction) * next.face!.normal.dot(ray.direction) < 0;
      const exit = closed ? next.distance : hit.distance + (surface === 'wood' || surface === 'glass' ? 0.12 : 1);
      obstacles.push({ entry: hit.distance, exit, material: surface }); if (closed) index++;
    }
  } else {
    for (const [index, box] of getColliders(map).entries()) {
      let entry = 0; let exit = definition.range;
      for (const axis of ['x', 'y', 'z'] as const) {
        if (Math.abs(ray.direction[axis]) < 1e-9) { if (ray.origin[axis] < box.min[axis] || ray.origin[axis] > box.max[axis]) exit = -1; continue; }
        const first = (box.min[axis] - ray.origin[axis]) / ray.direction[axis]; const second = (box.max[axis] - ray.origin[axis]) / ray.direction[axis];
        entry = Math.max(entry, Math.min(first, second)); exit = Math.min(exit, Math.max(first, second));
      }
      if (exit > entry && entry < definition.range) obstacles.push({ entry, exit, material: MAPS[map].solids[index].kind === 'crate' ? 'wood' : 'concrete' });
    }
    if (ray.direction.y < 0) { const floor = -ray.origin.y / ray.direction.y; if (floor > 0 && floor < definition.range) obstacles.push({ entry: floor, exit: floor + 10, material: 'concrete' }); }
    obstacles.sort((first, second) => first.entry - second.entry);
  }
  const passed: { distance: number; multiplier: number }[] = []; let remaining = energy; let distance = definition.range;
  for (const [index, obstacle] of obstacles.entries()) {
    const loss = 0.4 + (obstacle.exit - obstacle.entry) * SURFACE_DENSITY[obstacle.material];
    if (index >= 4 || remaining <= loss) { distance = obstacle.entry; break; }
    remaining -= loss; passed.push({ distance: obstacle.exit, multiplier: remaining / energy * Math.pow(0.85, index + 1) });
  }
  return { distance, surfaces: passed.length, multiplierAt: (range: number) => { let multiplier = 1; for (const surface of passed) if (surface.distance <= range) multiplier = surface.multiplier; return multiplier; } };
}

export function fireHitscan(shooter: Player, targets: Player[], input: Input, now: number, map: MapId, options: ShotOptions = {}) {
  const definition = WEAPONS[shooter.weapon];
  if (shooter.hp <= 0 || shooter.reloading || now - shooter.lastShot < definition.interval || shooter.ammo[shooter.weapon] <= 0) return null;
  if (now - shooter.lastShot > definition.interval * 2.5) shooter.spray = 0;
  const origin = new Vector3(shooter.x, shooter.y + eyeHeight(shooter.crouch), shooter.z);
  const points: Vector3[] = [];
  const hits = new Map<Player, { damage: number; head: boolean }>();
  for (let pellet = 0; pellet < definition.pellets; pellet++) {
    const aim = shotDirection(shooter, input, now, options.random);
    const ray = new Ray(origin, aim);
    const penetration = shooter.weapon === 'knife' ? null : traceBallisticPath(map, ray, shooter.weapon);
    let distance = penetration?.distance ?? wallHit(ray, definition.range, map);
    let victim: Player | undefined; let region: ReturnType<typeof hitPlayer> = null;
    for (const target of targets) {
      if (target.hp <= 0 || !opposingPlayers(options.mode || 'deathmatch', shooter, target)) continue;
      const pose = options.positions?.get(target.id) || target;
      if (pose.deaths !== undefined && pose.deaths !== target.deaths) continue;
      const hit = shooter.weapon === 'knife' ? hitMelee(origin, aim, pose, map) : hitPlayer(ray, pose);
      if (hit && hit.distance < distance) { distance = hit.distance; victim = target; region = hit; }
    }
    points.push(ray.at(distance, new Vector3()));
    if (options.utility && shooter.weapon !== 'knife') cutSmoke(options.utility, origin, points[points.length - 1], now);
    if (victim && region) {
      const previous = hits.get(victim);
      hits.set(victim, { damage: (previous?.damage || 0) + damageAtRange(shooter.weapon, distance) * region.multiplier * (penetration?.multiplierAt(distance) ?? 1), head: !!previous?.head || region.head });
    }
  }
  shooter.lastShot = now; shooter.spray++;
  if (shooter.weapon !== 'knife' && !options.unlimitedAmmo) shooter.ammo[shooter.weapon]--;
  const events: GameEvent[] = [{ type: shooter.weapon === 'knife' ? 'melee' : 'shot', id: shooter.id, weapon: shooter.weapon, origin, point: points[0], points: definition.pellets > 1 ? points : undefined }];
  const killed: Player[] = [];
  if (options.damageEnabled !== false) for (const [victim, hit] of hits) {
    const absorbed = Math.min(victim.armor, hit.damage * 0.25); const damage = Math.max(1, Math.round(hit.damage - absorbed));
    victim.armor = Math.max(0, victim.armor - absorbed); victim.hp = Math.max(0, victim.hp - damage);
    events.push({ type: 'hit', id: shooter.id, target: victim.id, head: hit.head, damage, origin });
    if (victim.hp === 0) {
      shooter.kills++; victim.deaths++; shooter.money = Math.min(16000, shooter.money + definition.killReward); killed.push(victim);
      events.push({ type: 'kill', id: shooter.id, target: victim.id, head: hit.head, weapon: shooter.weapon });
    }
  }
  return { events, hits: hits.size, killed };
}