import { Box3, Ray, Vector3 } from 'three';
import type { SkinAppearance } from './economy.ts';
import importedMaps from './imported-maps.json';
import { capsuleClear, importedRayHit, mapCell, mapGeometry, moveOnImportedMap, type ImportedMapMetadata } from './map-geometry.ts';

export type Team = 'T' | 'CT';
export type Mode = 'deathmatch' | 'defusal' | 'elimination' | 'training' | 'hill' | 'gungame' | 'ranked' | 'duel';
export function hasRespawns(mode: Mode) { return mode === 'deathmatch' || mode === 'hill' || mode === 'gungame'; }
export type Difficulty = 'easy' | 'normal' | 'hard';
export type ThrowableId = 'grenade' | 'flashbang' | 'smoke' | 'molotov';
export type MapId = 'dustline' | 'foundry' | 'tidebreak' | 'nightmarket' | 'training' | keyof typeof importedMaps;
export type WeaponId =
  | 'rifle' | 'pistol' | 'sniper' | 'carbine' | 'battleRifle' | 'burstRifle' | 'bullpup'
  | 'smg' | 'vector' | 'machinePistol' | 'shotgun' | 'autoShotgun' | 'marksman' | 'scout'
  | 'heavySniper' | 'revolver' | 'servicePistol' | 'compactSmg' | 'lmg' | 'handCannon' | 'knife';
export type Phase = 'waiting' | 'buy' | 'live' | 'over';
export type Vec = { x: number; y: number; z: number };
export type Input = {
  seq: number; time: number; forward: number; side: number; yaw: number; pitch: number;
  jump: boolean; crouch: boolean; sprint: boolean; fire: boolean; reload: boolean;
  scope: boolean; interact: boolean; weapon: WeaponId;
  utility?: ThrowableId;
};
export type Player = Vec & {
  id: string; name: string; team: Team; yaw: number; pitch: number; vx: number; vy: number; vz: number; landedAt: number;
  grounded: boolean; crouch: boolean; hp: number; armor: number; kills: number; deaths: number;
  money: number; weapon: WeaponId; ammo: Record<WeaponId, number>; reserve: Record<WeaponId, number>;
  owned: WeaponId[]; reloading: number; lastShot: number; respawnAt: number; seq: number;
  skin: number; knifeStyle: number; kit: boolean; cosmetics: Partial<Record<WeaponId, SkinAppearance>>;
  grenades: Record<ThrowableId, number>; lastThrow: number; flashedUntil: number; flashHoldUntil: number; flashStrength: number;
  spray: number;
  botSkill?: number;
};
export type Projectile = Vec & { id: string; owner: string; team: Team; kind: ThrowableId; vx: number; vy: number; vz: number; fuseAt: number };
export type DroppedWeapon = Vec & { id: string; weapon: WeaponId; ammo: number; reserve: number; appearance?: SkinAppearance; availableAt: number; expiresAt: number; vx?: number; vy?: number; vz?: number; yaw?: number; roll?: number; updatedAt?: number; settled?: boolean };
export type SmokeVolume = Vec & { id: string; expiresAt: number; cells: Vec[]; holes: { from: Vec; to: Vec; radius: number; until: number }[] };
export type FireVolume = Vec & { id: string; owner: string; team: Team; expiresAt: number; nextDamageAt: number; cells: Vec[] };
export type TrainingState = { difficulty: Difficulty; kind?: 'aim' | 'range'; range?: { distance: number; moving: boolean; armor: boolean; health: number; lastDamage: number }; endsAt: number; shots: number; hits: number; kills: number; score: number; streak: number; bestStreak: number; reactionTotal: number; responses: number; targetId: string | null; visibleSince: number; availableAt: number; complete: boolean };
export type HillState = { position: Vec; radius: number; target: number; held: Record<Team, number>; owner: Team | null; contested: boolean; updatedAt: number };
export type GunGameState = { levels: Record<string, number>; killsAtStart: Record<string, number> };
export type GameEvent = {
  type: 'shot' | 'melee' | 'hit' | 'kill' | 'reload' | 'chat' | 'round' | 'bomb' | 'throw' | 'explosion' | 'flash';
  id?: string; target?: string; weapon?: WeaponId; head?: boolean; damage?: number;
  point?: Vec; origin?: Vec; text?: string; team?: Team;
  equipment?: ThrowableId;
  points?: Vec[];
};
export type Snapshot = {
  type: 'state'; time: number; code: string; mode: Mode; map: MapId; players: Player[];
  phase: Phase; endsAt: number; score: Record<Team, number>; winner?: Team;
  buyEndsAt?: number; matchWinner?: Team; round?: number; difficulty?: Difficulty;
  matchComplete?: boolean; matchDraw?: boolean; winnerId?: string; hill?: HillState; gunGame?: GunGameState;
  projectiles?: Projectile[];
  drops?: DroppedWeapon[];
  visibility?: 'public' | 'private';
  smokes?: SmokeVolume[]; fires?: FireVolume[];
  training?: TrainingState;
  bomb: { planted: boolean; position: Vec | null; endsAt: number; progress: number; actor: string | null; carrier?: string | null; anchor?: Vec | null; lastActive?: number };
  environment?: EnvironmentState;
  events: GameEvent[];
};

export const STEP = 1 / 64;
export const WALK_SPEED = 4.8;
export const MAX_HOP_SPEED = 7.2;
export const PLAYER_RADIUS = 0.29;
export const MAP_AREA_MULTIPLIER = 8;
export const MAP_SIZE = 40 * Math.sqrt(MAP_AREA_MULTIPLIER);
export const DISTRICTS = [-76, 0, 76].flatMap(z => [-76, 0, 76].map(x => ({ x, z })));
export const SITES = [{ x: -65, y: 0, z: -59, name: 'A' }, { x: 65, y: 0, z: 59, name: 'B' }];
export type EnvironmentState = { time: 'dawn' | 'day' | 'dusk' | 'night'; weather: 'clear' | 'overcast' | 'rain' | 'fog' };
export type WeaponModel = 'rifle' | 'smg' | 'shotgun' | 'sniper' | 'pistol' | 'lmg' | 'knife';
export type WeaponDefinition = {
  name: string; short: string; category: string; model: WeaponModel; damage: number; interval: number;
  capacity: number; reload: number; spread: number; recoil: number; price: number; range: number;
  pellets: number; rangeModifier: number; killReward: number;
  scope?: { zoom: number; reticle: 'crosshair' | 'duplex' | 'mil-dot' | 'chevron' };
};
const weapon = (name: string, short: string, category: string, model: WeaponModel, damage: number, interval: number, capacity: number, reload: number, spread: number, recoil: number, price: number, range: number): WeaponDefinition => ({ name, short, category, model, damage, interval, capacity, reload, spread, recoil, price, range, pellets: model === 'shotgun' ? 12 : 1, rangeModifier: model === 'shotgun' ? 0.68 : model === 'smg' ? 0.84 : model === 'pistol' ? 0.88 : model === 'sniper' ? 0.99 : model === 'knife' ? 1 : 0.96, killReward: model === 'knife' ? 1500 : model === 'shotgun' ? 900 : model === 'smg' ? 600 : model === 'sniper' ? 100 : 300 });
export const WEAPONS: Record<WeaponId, WeaponDefinition> = {
  rifle: weapon('Vandal 762', 'V762', 'RIFLE', 'rifle', 36, 100, 30, 2400, 0.009, 0.018, 2700, 90),
  pistol: weapon('P-9 Service', 'P9', 'SIDEARM', 'pistol', 28, 230, 15, 1700, 0.006, 0.014, 250, 70),
  sniper: { ...weapon('Longbow 99', 'L99', 'SNIPER', 'sniper', 115, 1350, 5, 3100, 0.04, 0.055, 4750, 160), scope: { zoom: 5, reticle: 'crosshair' } },
  carbine: weapon('C8 Carbine', 'C8', 'RIFLE', 'rifle', 33, 92, 30, 2250, 0.011, 0.017, 2600, 90),
  battleRifle: weapon('BR-14', 'BR14', 'RIFLE', 'rifle', 44, 175, 20, 2500, 0.008, 0.026, 3100, 115),
  burstRifle: weapon('Burst-4', 'B4', 'RIFLE', 'rifle', 31, 270, 24, 2200, 0.008, 0.014, 2450, 85),
  bullpup: { ...weapon('Aster-5', 'A5', 'RIFLE', 'rifle', 30, 82, 35, 2400, 0.012, 0.015, 2550, 78), scope: { zoom: 1.5, reticle: 'chevron' } },
  smg: weapon('MP-9 Striker', 'MP9', 'SMG', 'smg', 23, 74, 32, 1950, 0.016, 0.012, 1250, 55),
  vector: weapon('Vector-45', 'V45', 'SMG', 'smg', 20, 58, 28, 2100, 0.021, 0.013, 1650, 48),
  machinePistol: weapon('MP-7 Compact', 'MP7', 'SMG', 'smg', 18, 62, 36, 1900, 0.019, 0.011, 1400, 50),
  shotgun: weapon('Breach-12', 'B12', 'SHOTGUN', 'shotgun', 12, 760, 8, 2650, 0.11, 0.05, 1850, 18),
  autoShotgun: weapon('AS-12 Cyclone', 'AS12', 'SHOTGUN', 'shotgun', 9, 390, 10, 3100, 0.14, 0.047, 2350, 16),
  marksman: { ...weapon('DMR-20', 'DMR', 'MARKSMAN', 'sniper', 67, 520, 10, 2800, 0.012, 0.035, 4200, 145), scope: { zoom: 3.5, reticle: 'duplex' } },
  scout: { ...weapon('Scout-5', 'S5', 'MARKSMAN', 'sniper', 72, 680, 10, 2450, 0.014, 0.03, 3600, 130), scope: { zoom: 3, reticle: 'mil-dot' } },
  heavySniper: { ...weapon('M-50 Sentinel', 'M50', 'SNIPER', 'sniper', 110, 1500, 4, 3300, 0.052, 0.062, 5000, 175), scope: { zoom: 7, reticle: 'mil-dot' } },
  revolver: weapon('R-8 Handcannon', 'R8', 'SIDEARM', 'pistol', 58, 390, 8, 2000, 0.018, 0.04, 700, 75),
  servicePistol: weapon('S-12 Sidearm', 'S12', 'SIDEARM', 'pistol', 25, 170, 17, 1650, 0.01, 0.015, 400, 65),
  compactSmg: weapon('Mantis-9', 'M9', 'SMG', 'smg', 21, 68, 30, 1850, 0.018, 0.013, 1500, 53),
  lmg: weapon('Negev', 'NEGEV', 'SUPPORT', 'lmg', 35, 75, 150, 5700, 0.045, 0.024, 1700, 92),
  handCannon: weapon('HC-45', 'HC45', 'SIDEARM', 'pistol', 48, 330, 9, 1950, 0.017, 0.036, 650, 72),
  knife: weapon('Field Knife', 'KNF', 'MELEE', 'knife', 55, 450, 1, 0, 0, 0.04, 0, 2.2),
};
export const THROWABLES: Record<ThrowableId, { name: string; price: number; limit: number; fuse: number; radius: number }> = {
  grenade: { name: 'HE Grenade', price: 300, limit: 1, fuse: 1800, radius: 9 },
  flashbang: { name: 'Flashbang', price: 200, limit: 2, fuse: 1500, radius: 25 },
  smoke: { name: 'Smoke Grenade', price: 300, limit: 1, fuse: 1800, radius: 4 },
  molotov: { name: 'Incendiary', price: 400, limit: 1, fuse: 1800, radius: 4 },
};
export function scopedFov(weapon: WeaponId, base: number) { return Math.atan(Math.tan(base * Math.PI / 360) / (WEAPONS[weapon].scope?.zoom || 1)) * 360 / Math.PI; }
export function loadoutSlot(weapon: WeaponId) { return WEAPONS[weapon].model === 'knife' ? 'knife' : WEAPONS[weapon].model === 'pistol' ? 'secondary' : 'primary'; }
export function opposingPlayers(mode: Mode, first: Player, second: Player) { return first.id !== second.id && (mode === 'gungame' || first.team !== second.team); }
export function equipPlayer(player: Player, weapon: WeaponId) {
  if (!player.owned.includes(weapon)) return false;
  if (player.weapon !== weapon) { player.weapon = weapon; player.reloading = 0; player.spray = 0; }
  return true;
}

const knifeNames = [
  'Arc Karambit', 'Raptor Karambit', 'Ember Talon', 'Vesper Talon', 'Crescent Hook', 'Ridgeback Bowie', 'Sunfall Bowie', 'Ironclad Tanto', 'Glassline Tanto', 'Warden Dagger',
  'Twin Fang', 'Nightglass Claw', 'Rift Claw', 'Harbor Kukri', 'Dustwake Kukri', 'Switchblade 09', 'Switchblade 12', 'Field Stiletto', 'Dusk Stiletto', 'Falcon Drop',
  'Cinder Fang', 'Breaker Cleaver', 'Signal Cleaver', 'Lattice Mamba', 'Coil Mamba', 'Hollowpoint', 'Northstar Edge', 'Shatterpoint', 'Gravemark', 'Kestrel Talon',
  'Viper Curve', 'Monarch Curve', 'Stormcut Saber', 'Sundown Saber', 'Recurve 7', 'Recurve 11', 'Razorback', 'Blackwater Edge', 'Driftwood Knife', 'Aerial Hook',
  'Copperhead', 'Peregrine', 'Frostbite Edge', 'Scoria Fang', 'Serrated Wraith', 'Quarry Knife', 'Orbit Karambit', 'Morrow Tanto', 'Floodplain Kukri', 'Last Light',
];
const knifeShapes = ['karambit', 'hook', 'bowie', 'tanto', 'dagger', 'claw', 'kukri', 'stiletto'] as const;
const knifeColors = ['#cf875d', '#a9c77b', '#75b6ca', '#d7d4bf', '#cd6f5f', '#9e8cca', '#d9ba69', '#6fa28d', '#c5dce2', '#e89e52'];
export const KNIFE_CATALOG = knifeNames.map((name, index) => ({
  id: index, name, shape: knifeShapes[index % knifeShapes.length], primary: knifeColors[index % knifeColors.length],
  accent: knifeColors[(index * 3 + 4) % knifeColors.length], price: 600 + (index % 10) * 250,
}));

export type Solid = { x: number; y: number; z: number; w: number; h: number; d: number; kind: 'wall' | 'crate' | 'step' | 'barrier' };
const dustlineSolids: Solid[] = [
  { x: 0, y: 2.5, z: -24, w: 49, h: 5, d: 1, kind: 'wall' },
  { x: 0, y: 2.5, z: 24, w: 49, h: 5, d: 1, kind: 'wall' },
  { x: -24, y: 2.5, z: 0, w: 1, h: 5, d: 48, kind: 'wall' },
  { x: 24, y: 2.5, z: 0, w: 1, h: 5, d: 48, kind: 'wall' },
  { x: -8, y: 2.2, z: -4, w: 1.2, h: 4.4, d: 18, kind: 'wall' },
  { x: 8, y: 2.2, z: 4, w: 1.2, h: 4.4, d: 18, kind: 'wall' },
  { x: -15, y: 2.2, z: 5, w: 14, h: 4.4, d: 1.2, kind: 'wall' },
  { x: 15, y: 2.2, z: -5, w: 14, h: 4.4, d: 1.2, kind: 'wall' },
  { x: -14, y: 1.1, z: -13, w: 3, h: 2.2, d: 3, kind: 'crate' },
  { x: -18, y: 1.1, z: -16, w: 2, h: 2.2, d: 2, kind: 'crate' },
  { x: 14, y: 1.1, z: 12, w: 3, h: 2.2, d: 3, kind: 'crate' },
  { x: 17, y: 0.65, z: 15, w: 2, h: 1.3, d: 2, kind: 'crate' },
  { x: -3, y: 0.7, z: -7, w: 2.5, h: 1.4, d: 2.5, kind: 'crate' },
  { x: 3, y: 0.7, z: 8, w: 2.5, h: 1.4, d: 2.5, kind: 'crate' },
  { x: -18, y: 0.6, z: 15, w: 5, h: 1.2, d: 1, kind: 'barrier' },
  { x: 18, y: 0.6, z: -15, w: 5, h: 1.2, d: 1, kind: 'barrier' },
  ...Array.from({ length: 6 }, (_, index): Solid => ({ x: -20, y: (index + 1) * 0.12, z: -4 - index * 0.8, w: 3.4, h: (index + 1) * 0.24, d: 0.8, kind: 'step' })),
  { x: -20, y: 0.72, z: -11, w: 3.4, h: 1.44, d: 4, kind: 'step' },
];
const perimeter: Solid[] = [
  { x: 0, y: 2.5, z: -24, w: 49, h: 5, d: 1, kind: 'wall' },
  { x: 0, y: 2.5, z: 24, w: 49, h: 5, d: 1, kind: 'wall' },
  { x: -24, y: 2.5, z: 0, w: 1, h: 5, d: 48, kind: 'wall' },
  { x: 24, y: 2.5, z: 0, w: 1, h: 5, d: 48, kind: 'wall' },
];
const solid = (x: number, z: number, w: number, d: number, h = 4, kind: Solid['kind'] = 'wall'): Solid => ({ x, y: h / 2, z, w, h, d, kind });
type MapDefinition = { id: MapId; name: string; subtitle: string; palette: { sky: string; ground: string; wall: string; trim: string; accent: string }; solids: Solid[]; imported?: ImportedMapMetadata };
export const MAPS: Record<MapId, MapDefinition> = {
  training: { id: 'training', name: 'Practice Facility', subtitle: 'Target hall / recoil range', palette: { sky: '#c3d9d8', ground: '#758d81', wall: '#c6d4c7', trim: '#456c68', accent: '#dbb968' }, solids: [
    solid(0, -32, 61, 1, 7), solid(0, 32, 61, 1, 7), solid(-30, 0, 1, 64, 7), solid(30, 0, 1, 64, 7),
    solid(-23, -5, 1, 36, 3), solid(23, -5, 1, 36, 3), solid(-18, 8, 9, 1, 1.1, 'barrier'), solid(18, 8, 9, 1, 1.1, 'barrier'),
    solid(0, -28, 16, 0.8, 6, 'wall'), solid(-19, -25, 4, 2, 1.2, 'crate'), solid(19, -25, 4, 2, 1.2, 'crate'),
  ] },
  dustline: { id: 'dustline', name: 'Dustline', subtitle: 'Sun-baked outskirts', palette: { sky: '#cbd9d6', ground: '#d4bf93', wall: '#dac9a6', trim: '#ae9e80', accent: '#cf643e' }, solids: dustlineSolids },
  foundry: { id: 'foundry', name: 'Foundry', subtitle: 'Cold steel / hot lanes', palette: { sky: '#a8b7b7', ground: '#727b73', wall: '#8c9387', trim: '#505d59', accent: '#d27c51' }, solids: [
    ...perimeter, solid(-10, 0, 1.3, 25), solid(10, 0, 1.3, 25), solid(0, -10, 19, 1.2), solid(0, 10, 19, 1.2),
    solid(-4.8, -4.8, 2.6, 2.6, 1.8, 'crate'), solid(4.8, 4.8, 2.6, 2.6, 1.8, 'crate'),
    solid(-16, -5, 5, 2, 1.4, 'crate'), solid(16, 5, 5, 2, 1.4, 'crate'),
    solid(0, 0, 5, 5, 2.8, 'crate'),
  ] },
  tidebreak: { id: 'tidebreak', name: 'Tidebreak', subtitle: 'Rain over the old port', palette: { sky: '#a4c0c2', ground: '#879b94', wall: '#afad96', trim: '#617d79', accent: '#dd885c' }, solids: [
    ...perimeter, solid(-13, -2, 14, 1.2), solid(13, 2, 14, 1.2), solid(-4, -13, 1.2, 14), solid(4, 13, 1.2, 14),
    solid(0, -6, 6, 1.1, 1.7, 'barrier'), solid(0, 6, 6, 1.1, 1.7, 'barrier'),
    solid(-16, 10, 3, 4, 2.4, 'crate'), solid(16, -10, 3, 4, 2.4, 'crate'),
    solid(-10, 15, 5, 2, 1.3, 'crate'), solid(10, -15, 5, 2, 1.3, 'crate'),
  ] },
  nightmarket: { id: 'nightmarket', name: 'Palace', subtitle: 'Sandstone arcades / palace approach', palette: { sky: '#b7cacc', ground: '#c9bba0', wall: '#d6ba99', trim: '#876e62', accent: '#65a5a1' }, solids: [
    ...perimeter, solid(-8, -10, 1.1, 17), solid(8, 10, 1.1, 17), solid(0, -15, 15, 1.1, 2.7), solid(0, 15, 15, 1.1, 2.7),
    solid(-14, -8, 4, 2.2, 1.5, 'crate'), solid(14, 8, 4, 2.2, 1.5, 'crate'),
    solid(-3, 0, 2.5, 4, 1.3, 'barrier'), solid(3, 0, 2.5, 4, 1.3, 'barrier'),
    solid(-14, 3, 3, 3, 2.2, 'crate'), solid(14, -3, 3, 3, 2.2, 'crate'),
  ] },
  ...Object.fromEntries<MapDefinition>(Object.entries(importedMaps).map(([id, metadata]) => [id, {
    id: id as MapId, name: metadata.name, subtitle: 'Supplied level / original architecture', imported: metadata as ImportedMapMetadata,
    palette: { sky: id === 'zona7' ? '#bac8d3' : '#cadcde', ground: '#8d9a8d', wall: '#c3c6ba', trim: '#647b78', accent: '#d66f46' }, solids: [],
  }])) as Record<keyof typeof importedMaps, MapDefinition>,
};
export const SUPPLIED_MAP_IDS = Object.values(MAPS).filter(map => map.imported && !['dust2', 'sandstone', 'collection', 'outpost'].includes(map.id)).map(map => map.id);
for (const map of Object.values(MAPS)) {
  if (map.imported || map.id === 'training') continue;
  map.solids = map.solids.filter(solid => Math.abs(solid.x) !== 24 && Math.abs(solid.z) !== 24).map(solid => ({
    ...solid, x: solid.x * 1.55, z: solid.z * 1.55, w: solid.w * 1.55, d: solid.d * 1.55,
  }));
  map.solids.push(solid(0, -40, 81, 1, 7), solid(0, 40, 81, 1, 7), solid(-40, 0, 1, 80, 7), solid(40, 0, 1, 80, 7));
  if (map.id === 'foundry') {
    for (const x of [-27, 27]) {
      map.solids.push(solid(x, 0, 4.5, 13, 2.5, 'crate'));
      for (let index = 0; index < 10; index++) map.solids.push(solid(x, 10 - index * 0.7, 3.5, 0.7, (index + 1) * 0.25, 'step'));
    }
    map.solids.push(solid(0, -25, 14, 4, 2.5, 'crate'));
  } else if (map.id === 'tidebreak') {
    map.solids.push({ x: 0, y: 4.5, z: 0, w: 7, h: 0.5, d: 30, kind: 'step' });
    for (let index = 0; index < 18; index++) map.solids.push(solid(0, 27 - index * 0.67, 5, 0.67, (index + 1) * 0.25, 'step'));
    for (const z of [-12, 12]) map.solids.push(solid(0, z, 1.2, 1.2, 4.5));
  } else if (map.id === 'nightmarket') {
    map.solids.push(solid(-28, -3, 10, 7, 2.5, 'step'));
    for (let index = 0; index < 10; index++) map.solids.push(solid(-28, 7 - index * 0.65, 4, 0.65, (index + 1) * 0.25, 'step'));
    map.solids.push(solid(27, 2, 4, 10, 1.4, 'barrier'));
  } else {
    map.solids.push(solid(27, -25, 3.2, 2.5, 1.5, 'crate'), solid(-27, 24, 3.2, 2.5, 1.5, 'crate'));
  }
  map.solids = map.solids.filter(value => Math.abs(value.x) !== 40 && Math.abs(value.z) !== 40);
  map.solids.push(solid(0, -MAP_SIZE, MAP_SIZE * 2 + 1, 1, 10), solid(0, MAP_SIZE, MAP_SIZE * 2 + 1, 1, 10), solid(-MAP_SIZE, 0, 1, MAP_SIZE * 2, 10), solid(MAP_SIZE, 0, 1, MAP_SIZE * 2, 10));
  for (const district of DISTRICTS.filter(district => district.x || district.z)) {
    const additions: Solid[] = [];
    const height = map.id === 'foundry' ? 7 : map.id === 'nightmarket' ? 6 : 5;
    for (const side of [-1, 1]) {
      additions.push(solid(district.x + side * 17, district.z, 1.5, 28, height));
      additions.push(solid(district.x, district.z + side * 17, 15, 1.4, height));
      additions.push(solid(district.x + side * 26, district.z + side * 10, 6, 1.2, 1.25, 'barrier'));
      additions.push(solid(district.x + side * 8, district.z - side * 6, 3.4, 3, side === 1 ? 1.4 : 2.5, 'crate'));
      additions.push(solid(district.x + side * 26, district.z - side * 25, 4, 5.5, 2.8, 'crate'));
    }
    additions.push(solid(district.x + 4, district.z, 8, 6, 2.5, 'step'));
    for (let index = 0; index < 10; index++) additions.push(solid(district.x + 4, district.z + 12 - index * 0.85, 3.5, 0.85, (index + 1) * 0.25, 'step'));
    const sites = getSites(map.id);
    map.solids.push(...additions.filter(cover => sites.every(site => Math.hypot(cover.x - site.x, cover.z - site.z) > Math.max(cover.w, cover.d) / 2 + 6)));
  }
}

export function getSites(map: MapId = 'dustline') {
  if (MAPS[map].imported) return MAPS[map].imported.sites;
  return map === 'foundry' ? [{ x: -76, y: 0, z: -51, name: 'A' }, { x: 76, y: 0, z: 51, name: 'B' }] :
    map === 'tidebreak' ? [{ x: -76, y: 0, z: -37, name: 'A' }, { x: 76, y: 0, z: 37, name: 'B' }] :
    map === 'nightmarket' ? [{ x: -62, y: 0, z: -65, name: 'A' }, { x: 62, y: 0, z: 65, name: 'B' }] : SITES;
}

export const SOLIDS = MAPS.dustline.solids;
const collidersByMap = Object.fromEntries(Object.entries(MAPS).map(([id, map]) => [id, map.solids.map(value => new Box3(
  new Vector3(value.x - value.w / 2, value.y - value.h / 2, value.z - value.d / 2),
  new Vector3(value.x + value.w / 2, value.y + value.h / 2, value.z + value.d / 2),
))])) as Record<MapId, Box3[]>;
export const COLLIDERS = collidersByMap.dustline;
export const getColliders = (map: MapId = 'dustline') => collidersByMap[map] || COLLIDERS;

export function eyeHeight(crouch: boolean) { return crouch ? 1.04 : 1.58; }

export function simulateMovement(player: Player, input: Input, frozen = false, map: MapId = 'dustline') {
  player.yaw = input.yaw;
  player.pitch = input.pitch;
  player.crouch = input.crouch;
  if (frozen || player.hp <= 0) { player.vx = player.vz = 0; return; }
  const speed = input.crouch ? 2.3 : input.scope ? 2.6 : WALK_SPEED;
  const length = Math.max(1, Math.hypot(input.forward, input.side));
  const forward = input.forward / length; const side = input.side / length;
  const wishX = -Math.sin(input.yaw) * forward + Math.cos(input.yaw) * side;
  const wishZ = -Math.cos(input.yaw) * forward - Math.sin(input.yaw) * side;
  const wasGrounded = player.grounded; const jumping = input.jump && wasGrounded && !input.crouch;
  if (wasGrounded) {
    const chained = jumping && !input.scope && input.time >= player.landedAt && input.time - player.landedAt <= 125 && player.landedAt > 0;
    const momentum = chained ? Math.min(MAX_HOP_SPEED, Math.max(speed, Math.hypot(player.vx || 0, player.vz || 0)) + 0.35) : speed;
    player.vx = wishX * momentum; player.vz = wishZ * momentum;
  } else {
    const amount = Math.hypot(wishX, wishZ);
    if (amount > 0) {
      const directionX = wishX / amount; const directionZ = wishZ / amount;
      const projected = (player.vx || 0) * directionX + (player.vz || 0) * directionZ;
      const acceleration = Math.max(0, Math.min(speed * amount - projected, speed * STEP * 8));
      player.vx = (player.vx || 0) + directionX * acceleration; player.vz = (player.vz || 0) + directionZ * acceleration;
    }
    const maximum = input.scope || input.crouch ? speed : MAX_HOP_SPEED; const horizontal = Math.hypot(player.vx || 0, player.vz || 0);
    if (horizontal > maximum) { player.vx *= maximum / horizontal; player.vz *= maximum / horizontal; }
  }
  const deltaX = (player.vx || 0) * STEP; const deltaZ = (player.vz || 0) * STEP;
  const startX = player.x; const startZ = player.z;
  const height = input.crouch ? 1.2 : 1.8;
  if (MAPS[map].imported) {
    if (!mapGeometry(map)) return;
    if (input.jump && player.grounded && !input.crouch) { player.vy = 6; player.grounded = false; }
    player.vy -= 18 * STEP;
    moveOnImportedMap(map, player, { x: deltaX, y: player.vy * STEP, z: deltaZ }, height);
    if (player.grounded && (!wasGrounded || jumping)) player.landedAt = input.time;
    if (Math.abs(deltaX) > 0.00001 && Math.abs(player.x - startX) < Math.abs(deltaX) * 0.3) player.vx = 0;
    if (Math.abs(deltaZ) > 0.00001 && Math.abs(player.z - startZ) < Math.abs(deltaZ) * 0.3) player.vz = 0;
    return;
  }
  for (const axis of ['x', 'z'] as const) {
    player[axis] += axis === 'x' ? deltaX : deltaZ;
    for (const box of getColliders(map)) {
      if (player.x + PLAYER_RADIUS > box.min.x && player.x - PLAYER_RADIUS < box.max.x &&
          player.z + PLAYER_RADIUS > box.min.z && player.z - PLAYER_RADIUS < box.max.z &&
          player.y < box.max.y - 0.01 && player.y + height > box.min.y + 0.01) {
        if (player.grounded && box.max.y - player.y <= 0.26) { player.y = box.max.y; continue; }
        const delta = axis === 'x' ? deltaX : deltaZ;
        if (delta > 0) player[axis] = box.min[axis] - PLAYER_RADIUS;
        else if (delta < 0) player[axis] = box.max[axis] + PLAYER_RADIUS;
      }
    }
  }
  if (input.jump && player.grounded && !input.crouch) { player.vy = 6; player.grounded = false; }
  const previousY = player.y;
  player.vy -= 18 * STEP;
  player.y += player.vy * STEP;
  player.grounded = false;
  let floor = 0;
  for (const box of getColliders(map)) {
    if (player.x + PLAYER_RADIUS > box.min.x && player.x - PLAYER_RADIUS < box.max.x &&
        player.z + PLAYER_RADIUS > box.min.z && player.z - PLAYER_RADIUS < box.max.z &&
        previousY >= box.max.y - 0.03 && player.y <= box.max.y) floor = Math.max(floor, box.max.y);
  }
  if (player.y <= floor) { player.y = floor; player.vy = 0; player.grounded = true; }
  player.x = Math.max(-MAP_SIZE + 0.8, Math.min(MAP_SIZE - 0.8, player.x));
  player.z = Math.max(-MAP_SIZE + 0.8, Math.min(MAP_SIZE - 0.8, player.z));
  if (player.grounded && (!wasGrounded || jumping)) player.landedAt = input.time;
  if (Math.abs(deltaX) > 0.00001 && Math.abs(player.x - startX) < Math.abs(deltaX) * 0.3) player.vx = 0;
  if (Math.abs(deltaZ) > 0.00001 && Math.abs(player.z - startZ) < Math.abs(deltaZ) * 0.3) player.vz = 0;
}

export function createPlayer(id: string, name: string, team: Team, mode: Mode, index: number): Player {
  const player: Player = {
    id, name, team, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, landedAt: 0, yaw: 0, pitch: 0, grounded: true, crouch: false,
    hp: 100, armor: mode === 'deathmatch' ? 100 : 0, kills: 0, deaths: 0,
    money: mode === 'defusal' || mode === 'ranked' ? 800 : 16000, weapon: 'pistol',
    ammo: Object.fromEntries(Object.entries(WEAPONS).map(([id, data]) => [id, data.capacity])) as Record<WeaponId, number>,
    reserve: Object.fromEntries(Object.entries(WEAPONS).map(([id, data]) => [id, id === 'knife' ? 0 : data.capacity * 3])) as Record<WeaponId, number>,
    owned: ['pistol', 'knife'],
    reloading: 0, lastShot: 0, respawnAt: 0, seq: -1, skin: 0, knifeStyle: 0, kit: false, cosmetics: {},
    grenades: { grenade: 0, flashbang: 0, smoke: 0, molotov: 0 }, lastThrow: 0, flashedUntil: 0, flashHoldUntil: 0, flashStrength: 0, spray: 0,
  };
  spawn(player, index);
  return player;
}

export function walkable(x: number, z: number, map: MapId, radius = PLAYER_RADIUS + 0.15) {
  if (MAPS[map].imported) {
    const geometry = mapGeometry(map); const point = mapCell(map, x, z);
    return !!geometry && !!point && capsuleClear(geometry.bvh, { x, y: point.y, z }, 1.8, radius);
  }
  return Math.abs(x) < MAP_SIZE - 1 && Math.abs(z) < MAP_SIZE - 1 && !getColliders(map).some(box =>
    box.min.y < 1.8 && box.max.y > 0.26 && x + radius > box.min.x && x - radius < box.max.x && z + radius > box.min.z && z - radius < box.max.z);
}

export function spawnPoints(team: Team, map: MapId, deathmatch = false) {
  const imported = MAPS[map].imported;
  if (imported) return imported.spawns[team];
  if (map === 'training') return Array.from({ length: 6 }, (_, index) => ({ x: (index % 3 - 1) * 2, y: 0, z: team === 'CT' ? 16 + Math.floor(index / 3) * 2 : -16 - Math.floor(index / 3) * 2 }));
  const positions: Vec[] = [];
  for (const x of [-96, -72, -48, -24, 0, 24, 48, 72, 96]) for (const z of deathmatch ? [-96, -72, -33, -15, 15, 33, 72, 96] : team === 'T' ? [102, 97] : [-102, -97]) {
    if (walkable(x, z, map, 0.7)) positions.push({ x, y: 0, z });
  }
  return positions;
}

export function spawn(player: Player, index: number, map: MapId = 'dustline', players: Player[] = [], deathmatch = false, freeForAll = false) {
  const navigation = freeForAll ? mapGeometry(map)?.metadata.navigation : undefined;
  const positions = navigation?.length ? navigation.filter((_, slot) => slot % Math.max(1, Math.floor(navigation.length / 256)) === 0) : freeForAll ? [...spawnPoints('CT', map, true), ...spawnPoints('T', map, true)] : spawnPoints(player.team, map, deathmatch);
  const occupied = players.filter(other => other.id !== player.id && other.hp > 0);
  let choices = positions.filter(position => occupied.every(other => Math.hypot(position.x - other.x, position.z - other.z) > 1.2));
  if (!choices.length) choices = positions;
  if (deathmatch || freeForAll) choices.sort((first, second) => {
    const enemies = occupied.filter(other => freeForAll || other.team !== player.team);
    const safety = (position: { x: number; z: number }) => Math.min(100, ...enemies.map(enemy => Math.hypot(position.x - enemy.x, position.z - enemy.z)));
    return safety(second) - safety(first);
  });
  const position = choices[deathmatch || freeForAll ? 0 : index % choices.length] || { x: 0, y: 0, z: 30 };
  if (player.hp <= 0) { player.grenades = { grenade: 0, flashbang: 0, smoke: 0, molotov: 0 }; player.owned = ['pistol', 'knife']; player.weapon = 'pistol'; }
  Object.assign(player, position, { vx: 0, vy: 0, vz: 0, landedAt: 0, hp: 100, grounded: true, crouch: false, reloading: 0, respawnAt: 0, lastShot: 0, lastThrow: 0, flashedUntil: 0, flashHoldUntil: 0, flashStrength: 0, spray: 0 });
  player.yaw = player.team === 'T' ? 0 : Math.PI;
  player.pitch = 0;
  for (const weapon of Object.keys(WEAPONS) as WeaponId[]) {
    player.ammo[weapon] = WEAPONS[weapon].capacity;
    player.reserve[weapon] = WEAPONS[weapon].capacity * 3;
  }
}

export function direction(yaw: number, pitch: number) {
  return new Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}

export const RECOIL_PATTERNS: Partial<Record<WeaponId, readonly (readonly [number, number])[]>> = {
  rifle: [[0, 0], [0.001, 0.008], [-0.003, 0.016], [-0.004, 0.023], [0.002, 0.029], [0.008, 0.034], [0.015, 0.038], [0.021, 0.04], [0.018, 0.041], [0.01, 0.042], [-0.002, 0.043], [-0.015, 0.044], [-0.025, 0.043], [-0.03, 0.042], [-0.024, 0.044], [-0.012, 0.045], [0.004, 0.044], [0.02, 0.043], [0.031, 0.045], [0.024, 0.046]],
  carbine: [[0, 0], [-0.001, 0.006], [-0.002, 0.012], [0.001, 0.018], [0.004, 0.023], [0.009, 0.027], [0.014, 0.03], [0.016, 0.032], [0.01, 0.033], [0, 0.034], [-0.01, 0.035], [-0.017, 0.036], [-0.02, 0.035], [-0.014, 0.036], [-0.003, 0.037], [0.009, 0.036]],
};
export function damageAtRange(id: WeaponId, distance: number) { const definition = WEAPONS[id]; return distance > definition.range ? 0 : definition.damage * Math.pow(definition.rangeModifier, Math.max(0, distance) / 10); }

export function shotDirection(player: Pick<Player, 'weapon' | 'grounded' | 'lastShot'> & Partial<Pick<Player, 'spray'>>, input: Pick<Input, 'yaw' | 'pitch' | 'forward' | 'side' | 'scope' | 'crouch'>, now: number, random = Math.random) {
  const weapon = WEAPONS[player.weapon];
  const moving = Math.hypot(input.forward, input.side) > 0.05;
  const spraying = now - player.lastShot < weapon.interval * 2.5;
  let spread = !player.grounded ? weapon.spread * 5 : moving ? weapon.spread * 2.5 : spraying ? weapon.spread : 0;
  if (weapon.model === 'sniper') spread = input.scope && player.grounded && !moving ? 0 : Math.max(spread, weapon.spread * 2);
  if (weapon.model === 'shotgun') spread = weapon.spread;
  if (input.crouch && player.grounded) spread *= 0.5;
  const pattern = RECOIL_PATTERNS[player.weapon];
  const recoil = spraying && pattern ? pattern[Math.min(player.spray || 0, pattern.length - 1)] : [0, 0];
  if (!spread || player.weapon === 'knife') return direction(input.yaw + recoil[0], input.pitch + recoil[1]);
  const angle = random() * Math.PI * 2;
  const radius = Math.sqrt(random()) * spread;
  return direction(input.yaw + recoil[0] + Math.cos(angle) * radius, input.pitch + recoil[1] + Math.sin(angle) * radius);
}

export function wallHit(ray: Ray, range: number, map: MapId = 'dustline') {
  if (MAPS[map].imported) return importedRayHit(map, ray, range);
  const point = new Vector3();
  let nearest = range;
  for (const box of getColliders(map)) {
    const hit = ray.intersectBox(box, point);
    if (hit) nearest = Math.min(nearest, ray.origin.distanceTo(hit));
  }
  if (ray.direction.y < 0) {
    const floor = -ray.origin.y / ray.direction.y;
    if (floor > 0) nearest = Math.min(nearest, floor);
  }
  return nearest;
}

export function hitPlayer(ray: Ray, player: Pick<Player, 'x' | 'y' | 'z' | 'crouch'>) {
  const scale = player.crouch ? 0.66 : 1;
  const regions = [
    { part: 'head', multiplier: 4, cx: 0, cy: 1.55, width: 0.36, height: 0.4, depth: 0.36 },
    { part: 'chest', multiplier: 1, cx: 0, cy: 1.0, width: 0.47, height: 0.7, depth: 0.36 },
    { part: 'limbs', multiplier: 0.75, cx: 0, cy: 0.36, width: 0.45, height: 0.72, depth: 0.36 },
    { part: 'limbs', multiplier: 0.75, cx: -0.34, cy: 1, width: 0.2, height: 0.65, depth: 0.32 },
    { part: 'limbs', multiplier: 0.75, cx: 0.34, cy: 1, width: 0.2, height: 0.65, depth: 0.32 },
  ];
  let result: { distance: number; multiplier: number; head: boolean } | null = null;
  for (const region of regions) {
    const center = new Vector3(player.x + region.cx, player.y + region.cy * scale, player.z);
    const size = new Vector3(region.width, region.height * scale, region.depth);
    const box = new Box3().setFromCenterAndSize(center, size);
    const point = ray.intersectBox(box, new Vector3());
    if (point) {
      const distance = ray.origin.distanceTo(point);
      if (!result || distance < result.distance) result = { distance, multiplier: region.multiplier, head: region.part === 'head' };
    }
  }
  return result;
}

export function hitMelee(origin: Vector3, aim: Vector3, target: Pick<Player, 'x' | 'y' | 'z' | 'crouch'>, map: MapId = 'dustline') {
  let nearest: { distance: number; multiplier: number; head: boolean } | null = null;
  for (const angle of [-0.28, -0.14, 0, 0.14, 0.28]) {
    const ray = new Ray(origin, aim.clone().applyAxisAngle(new Vector3(0, 1, 0), angle));
    const hit = hitPlayer(ray, target);
    if (hit && hit.distance < wallHit(ray, WEAPONS.knife.range, map) && (!nearest || hit.distance < nearest.distance)) nearest = { distance: hit.distance, multiplier: 1, head: false };
  }
  return nearest;
}