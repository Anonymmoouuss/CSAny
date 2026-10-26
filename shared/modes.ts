import { getSites, spawnPoints, WEAPONS, type MapId, type Player, type Snapshot, type Team, type Vec, type WeaponId } from './game.ts';
import { capsuleClear, mapGeometry } from './map-geometry.ts';

export const HILL_TARGET = 250000;
export const GUN_GAME_DURATION = 300000;
export const GUN_GAME_ORDER: readonly WeaponId[] = ['servicePistol', 'pistol', 'machinePistol', 'compactSmg', 'smg', 'vector', 'shotgun', 'autoShotgun', 'burstRifle', 'bullpup', 'carbine', 'rifle', 'lmg', 'battleRifle', 'handCannon', 'revolver', 'scout', 'marksman', 'heavySniper', 'sniper'];
type ObjectiveState = Pick<Snapshot, 'mode' | 'map' | 'phase' | 'endsAt' | 'hill' | 'gunGame'>;

export function hillPosition(map: MapId): Vec {
  const starts = [...spawnPoints('CT', map), ...spawnPoints('T', map)];
  const centre = starts.reduce((sum, point) => ({ x: sum.x + point.x / starts.length, y: sum.y + point.y / starts.length, z: sum.z + point.z / starts.length }), { x: 0, y: 0, z: 0 });
  const geometry = mapGeometry(map); if (!geometry) return { x: 0, y: 0, z: 0 };
  let best = geometry.metadata.navigation[0] || getSites(map)[0]; let distance = Infinity;
  for (const point of geometry.metadata.navigation) {
    if (!capsuleClear(geometry.bvh, point, 1.8, 1.2)) continue;
    const score = Math.hypot(point.x - centre.x, point.z - centre.z) + Math.abs(point.y - centre.y) * 2;
    if (score < distance) { best = point; distance = score; }
  }
  return { x: best.x, y: best.y, z: best.z };
}

export function equipGunGame(player: Player, level: number) {
  const weapon = GUN_GAME_ORDER[Math.min(GUN_GAME_ORDER.length - 1, Math.max(0, level))];
  player.owned = [weapon, 'knife']; player.weapon = weapon; player.reloading = 0; player.spray = 0;
  player.ammo[weapon] = WEAPONS[weapon].capacity; player.reserve[weapon] = WEAPONS[weapon].capacity * 5;
}

export function initializeObjectiveMode(state: ObjectiveState, players: Player[], now: number) {
  state.hill = undefined; state.gunGame = undefined;
  if (state.mode === 'hill') {
    state.hill = { position: hillPosition(state.map), radius: 7, target: HILL_TARGET, held: { CT: 0, T: 0 }, owner: null, contested: false, updatedAt: now }; state.endsAt = 0;
  }
  if (state.mode === 'gungame') {
    state.gunGame = { levels: Object.fromEntries(players.map(player => [player.id, 0])), killsAtStart: Object.fromEntries(players.map(player => [player.id, player.kills])) };
    state.endsAt = now + GUN_GAME_DURATION; players.forEach(player => equipGunGame(player, 0));
  }
}

export function gunGameKill(state: ObjectiveState, killer: Player, weapon: WeaponId) {
  if (state.mode !== 'gungame' || !state.gunGame) return false;
  const level = state.gunGame.levels[killer.id] || 0;
  if (weapon !== GUN_GAME_ORDER[level]) return false;
  if (level === GUN_GAME_ORDER.length - 1) return true;
  state.gunGame.levels[killer.id] = level + 1; equipGunGame(killer, level + 1); return false;
}

export function advanceObjectiveMode(state: ObjectiveState, players: Player[], now: number): { team: Team; player?: string } | null {
  if (state.phase !== 'live') return null;
  if (state.mode === 'hill' && state.hill) {
    const hill = state.hill; const elapsed = Math.max(0, Math.min(250, now - hill.updatedAt)); hill.updatedAt = now;
    const occupants = players.filter(player => player.hp > 0 && Math.abs(player.y - hill.position.y) < 2 && Math.hypot(player.x - hill.position.x, player.z - hill.position.z) <= hill.radius);
    const teams = new Set(occupants.map(player => player.team)); hill.contested = teams.size > 1; hill.owner = teams.size === 1 ? occupants[0].team : null;
    if (hill.owner) { hill.held[hill.owner] = Math.min(hill.target, hill.held[hill.owner] + elapsed); if (hill.held[hill.owner] >= hill.target) return { team: hill.owner }; }
  }
  if (state.mode === 'gungame' && state.gunGame && now >= state.endsAt && players.length) {
    const game = state.gunGame;
    const best = [...players].sort((first, second) => (game.levels[second.id] || 0) - (game.levels[first.id] || 0) || (second.kills - (game.killsAtStart[second.id] || 0)) - (first.kills - (game.killsAtStart[first.id] || 0)) || first.deaths - second.deaths || first.id.localeCompare(second.id))[0];
    return { team: best.team, player: best.id };
  }
  return null;
}