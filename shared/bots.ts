import PathFinding from 'pathfinding';
import { Ray, Vector3 } from 'three';
import { MAP_SIZE, MAPS, DISTRICTS, WEAPONS, eyeHeight, getSites, opposingPlayers, wallHit, walkable, type Input, type MapId, type Player, type Vec } from './game.ts';
import { isBombRound, type RoundState } from './round.ts';
import { mapCell, mapGeometry, walkLink } from './map-geometry.ts';
import { smokeBlocks } from './equipment.ts';

const grids = new Map<MapId, { grid: PathFinding.Grid; cell: number; radius: number }>();
const links = new Map<MapId, Map<string, boolean>>();
const CELL = 2;
const GRID_RADIUS = Math.ceil(MAP_SIZE / CELL);
const finder = new PathFinding.AStarFinder({ diagonalMovement: PathFinding.DiagonalMovement.OnlyWhenNoObstacles });
type RouteBook = { round: number; map: MapId; routes: Map<string, { team: Player['team']; path: Vec[]; goal: Vec }> };
const routeBooks = new WeakMap<RoundState, RouteBook>();
function routesFor(state: RoundState) {
  let book = routeBooks.get(state);
  if (!book || book.round !== state.round || book.map !== state.map) { book = { round: state.round, map: state.map, routes: new Map() }; routeBooks.set(state, book); }
  return book;
}
export type BotBrain = { path: Vec[]; nextPlan: number; nextShot: number; goal: Vec | null; lastSeen: Vec | null; seenAt: number; patrol: number; targetId: string | null; reactAt: number; routeId: number; movedAt: number; position: Vec | null; nextUtility: number; seed: number; round: number; approachKey: string; approach: Vec | null; role: 'entry' | 'support' | 'anchor' };
export const createBrain = (index = 0, random = Math.random): BotBrain => ({ path: [], nextPlan: 0, nextShot: 0, goal: null, lastSeen: null, seenAt: 0, patrol: index, targetId: null, reactAt: 0, routeId: index + 1, movedAt: 0, position: null, nextUtility: 0, seed: Math.floor(random() * 1000000) + index * 7919, round: -1, approachKey: '', approach: null, role: (['entry', 'support', 'anchor'] as const)[index % 3] });

export function teammateSeparation(bot: Player, players: Player[], map: MapId) {
  let x = 0; let z = 0;
  for (const other of players) {
    if (other.id === bot.id || other.team !== bot.team || other.hp <= 0 || Math.abs(other.y - bot.y) > 1.5) continue;
    const distance = Math.hypot(bot.x - other.x, bot.z - other.z); if (distance >= 2.5) continue;
    const strength = (2.5 - distance) / 2.5;
    if (distance < 0.05) x += bot.id < other.id ? strength : -strength;
    else { x += (bot.x - other.x) / distance * strength; z += (bot.z - other.z) / distance * strength; }
  }
  const length = Math.hypot(x, z); if (!length) return { x: 0, z: 0 };
  const proposed = { x: bot.x + x / length * 0.6, y: bot.y, z: bot.z + z / length * 0.6 };
  if (mapGeometry(map) ? !walkLink(mapGeometry(map)!.bvh, bot, proposed) : !walkable(proposed.x, proposed.z, map, 0.35)) return { x: 0, z: 0 };
  return { x: x / Math.max(1, length), z: z / Math.max(1, length) };
}

function approachPoint(target: Vec, brain: BotBrain, state: RoundState, label: string, radius = 9, owner?: Player) {
  const key = `${label}:${state.round}:${brain.patrol}:${Math.round(target.x / 4)}:${Math.round(target.z / 4)}`;
  if (brain.approach && key === brain.approachKey) return brain.approach;
  const angle = ((brain.seed * 0.61803398875 + brain.patrol * 0.381966 + state.round * 0.2718) % 1) * Math.PI * 2;
  const desired = { x: target.x + Math.sin(angle) * radius, y: target.y, z: target.z + Math.cos(angle) * radius };
  const navigation = mapGeometry(state.map)?.metadata.navigation;
  let best = target; let distance = Infinity;
  for (const point of navigation || [desired, target]) {
    if (Math.abs(point.y - target.y) > 2 || !navigation && !walkable(point.x, point.z, state.map)) continue;
    let score = Math.hypot(point.x - desired.x, point.z - desired.z);
    for (const [id, route] of routesFor(state).routes) if (owner && id !== owner.id && route.team === owner.team && Math.abs(route.goal.y - point.y) < 2) score += Math.max(0, 5 - Math.hypot(point.x - route.goal.x, point.z - route.goal.z)) * 2;
    if (score < distance) { distance = score; best = point; }
  }
  brain.approach = { x: best.x, y: best.y, z: best.z }; brain.approachKey = key; return brain.approach;
}

function gridFor(map: MapId) {
  const cached = grids.get(map); if (cached) return cached;
  const imported = mapGeometry(map);
  const cell = imported?.metadata.cell || CELL; const radius = Math.ceil(MAP_SIZE / cell);
  const grid = new PathFinding.Grid(radius * 2 + 1, radius * 2 + 1);
  for (let row = 0; row <= radius * 2; row++) for (let column = 0; column <= radius * 2; column++) {
    const x = (column - radius) * cell; const z = (row - radius) * cell;
    grid.setWalkableAt(column, row, imported ? !!mapCell(map, x, z) : walkable(x, z, map, 1.1));
  }
  const result = { grid, cell, radius }; if (!MAPS[map].imported || imported) grids.set(map, result); return result;
}

function nearestCell(grid: PathFinding.Grid, position: Vec, cell: number, gridRadius: number) {
  const column = Math.round(position.x / cell + gridRadius); const row = Math.round(position.z / cell + gridRadius);
  for (let radius = 0; radius < 10; radius++) for (let offsetRow = -radius; offsetRow <= radius; offsetRow++) for (let offsetColumn = -radius; offsetColumn <= radius; offsetColumn++) {
    if (grid.isInside(column + offsetColumn, row + offsetRow) && grid.isWalkableAt(column + offsetColumn, row + offsetRow)) return [column + offsetColumn, row + offsetRow];
  }
  return null;
}

export function navigate(map: MapId, from: Vec, to: Vec, routeId = 0, hazards?: Pick<RoundState, 'fires' | 'smokes'>, reservations?: ReadonlySet<string>): Vec[] {
  if (MAPS[map].imported && !mapGeometry(map)) return [];
  const { grid, cell, radius } = gridFor(map); const start = nearestCell(grid, from, cell, radius); const end = nearestCell(grid, to, cell, radius);
  if (!start || !end) return [];
  const geometry = mapGeometry(map);
  function findRoute(fromCell: number[], toCell: number[], avoidReserved = false) {
    const route = grid.clone();
    if (avoidReserved) for (const key of reservations || []) {
      const [column, row] = key.split(',').map(Number).map(value => value + radius);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const x = column + dx; const z = row + dz;
        if (route.isInside(x, z) && Math.hypot(x - fromCell[0], z - fromCell[1]) * cell > 3 && Math.hypot(x - toCell[0], z - toCell[1]) * cell > 3) route.setWalkableAt(x, z, false);
      }
    }
    for (const fire of hazards?.fires || []) for (const point of fire.cells) {
      const column = Math.round(point.x / cell + radius); const row = Math.round(point.z / cell + radius);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (route.isInside(column + dx, row + dz) && (column + dx !== fromCell[0] || row + dz !== fromCell[1])) route.setWalkableAt(column + dx, row + dz, false);
    }
    if (geometry) {
    let cached = links.get(map); if (!cached) { cached = new Map(); links.set(map, cached); }
    const neighbors = route.getNeighbors.bind(route);
    route.getNeighbors = (node, diagonal) => neighbors(node, diagonal).filter(next => {
      const start = node.y * (radius * 2 + 1) + node.x; const end = next.y * (radius * 2 + 1) + next.x;
      const key = start < end ? `${start}:${end}` : `${end}:${start}`;
      if (cached!.has(key)) return cached!.get(key)!;
      const from = mapCell(map, (node.x - radius) * cell, (node.y - radius) * cell); const to = mapCell(map, (next.x - radius) * cell, (next.y - radius) * cell);
      const clear = !!from && !!to && walkLink(geometry.bvh, from, to); cached!.set(key, clear); return clear;
    });
    }
    return finder.findPath(fromCell[0], fromCell[1], toCell[0], toCell[1], route);
  }
  let path = findRoute(start, end);
  let coordinated = false;
  if (reservations?.size && path.length) {
    const alternate = findRoute(start, end, true);
    if (alternate.length && alternate.length <= path.length * 2 + 10) { path = alternate; coordinated = true; }
  }
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  if (!coordinated && routeId && path.length > 12 && distance > 12) {
    const progress = 0.3 + routeId % 5 * 0.1;
    const lane = (routeId % 9 - 4) * 3;
    const via = nearestCell(grid, { x: from.x + (to.x - from.x) * progress - (to.z - from.z) / distance * lane, y: from.y, z: from.z + (to.z - from.z) * progress + (to.x - from.x) / distance * lane }, cell, radius);
    if (via) {
      const first = findRoute(start, via); const second = findRoute(via, end);
      if (first.length && second.length && first.length + second.length < path.length * 1.8 + 8) path = first.concat(second.slice(1));
    }
  }
  return path.slice(1).map(([column, row]) => {
    const x = (column - radius) * cell; const z = (row - radius) * cell;
    return { x, y: mapCell(map, x, z)?.y || 0, z };
  });
}

export function planBotRoute(bot: Player, players: Player[], state: RoundState, brain: BotBrain, goal: Vec) {
  const book = routesFor(state); const roster = players.filter(player => player.team === bot.team && player.hp > 0).sort((first, second) => first.id.localeCompare(second.id));
  const slot = Math.max(0, roster.findIndex(player => player.id === bot.id)); const lanes = [0, 8, 2, 6, 4, 1, 7, 3, 5];
  brain.routeId = Math.floor((brain.seed + state.round * 104729 + brain.routeId) / 45) * 45 + lanes[(slot + state.round - 1) % lanes.length];
  const cell = mapGeometry(state.map)?.metadata.cell || CELL; const reservations = new Set<string>();
  for (const [id, route] of book.routes) {
    if (!players.some(player => player.id === id && player.hp > 0)) { book.routes.delete(id); continue; }
    if (id !== bot.id && route.team === bot.team) for (const point of route.path) reservations.add(`${Math.round(point.x / cell)},${Math.round(point.z / cell)}`);
  }
  const path = navigate(state.map, bot, goal, brain.routeId, state, reservations);
  book.routes.set(bot.id, { team: bot.team, path, goal: { x: goal.x, y: goal.y, z: goal.z } });
  return path;
}

export function visible(shooter: Player, target: Player, map: MapId) {
  const origin = new Vector3(shooter.x, shooter.y + eyeHeight(shooter.crouch), shooter.z);
  const point = new Vector3(target.x, target.y + (target.crouch ? 0.85 : 1.18), target.z);
  const distance = origin.distanceTo(point);
  return distance < 55 && wallHit(new Ray(origin, point.sub(origin).normalize()), distance, map) >= distance - 0.2;
}

export function botInput(bot: Player, players: Player[], state: RoundState, brain: BotBrain, now: number): Input {
  const input: Input = { seq: Math.floor(now), time: now, forward: 0, side: 0, yaw: bot.yaw, pitch: bot.pitch, jump: false, crouch: false, sprint: false, fire: false, reload: false, scope: false, interact: false, weapon: bot.weapon };
  if (bot.hp <= 0 || state.phase !== 'live') return input;
  if (bot.flashStrength > 0.35 && now < bot.flashedUntil - 350) return input;
  if (brain.round !== state.round) { brain.round = state.round; brain.routeId = (brain.seed + state.round * 104729) % 99991 + 1; brain.path = []; brain.goal = null; brain.approachKey = ''; }
  if (!brain.position || Math.hypot(bot.x - brain.position.x, bot.z - brain.position.z) > 0.45) { brain.position = { x: bot.x, y: bot.y, z: bot.z }; brain.movedAt = now; }
  if (brain.path.length && now - brain.movedAt > 1400) { brain.routeId += 7; brain.path = []; brain.nextPlan = 0; brain.movedAt = now; input.jump = bot.grounded; }
  const enemies = players.filter(player => player.hp > 0 && opposingPlayers(state.mode, bot, player)).sort((first, second) => Math.hypot(bot.x - first.x, bot.z - first.z) - Math.hypot(bot.x - second.x, bot.z - second.z));
  const target = enemies.find(player => visible(bot, player, state.map) && !smokeBlocks(state, { x: bot.x, y: bot.y + eyeHeight(bot.crouch), z: bot.z }, { x: player.x, y: player.y + 1.1, z: player.z }, now));
  const difficulty = state.difficulty || 'normal';
  const rankedSkill = state.mode === 'ranked' ? Math.max(0, Math.min(17, bot.botSkill || 0)) : 0;
  if (target?.id !== brain.targetId) {
    brain.targetId = target?.id || null;
    brain.reactAt = now + (state.mode === 'ranked' ? 420 - rankedSkill * 12 : difficulty === 'easy' ? 780 : difficulty === 'hard' ? 260 : 480) + brain.patrol % 4 * 70;
  }
  if (target) { brain.lastSeen = { x: target.x, y: target.y, z: target.z }; brain.seenAt = now; }
  const sites = getSites(state.map);
  const navigation = mapGeometry(state.map)?.metadata.navigation;
  const patrols = navigation?.length ? Array.from({ length: 12 }, (_, index) => navigation[Math.floor(index / 12 * navigation.length)]) : DISTRICTS.map(district => ({ x: district.x - 8, y: 0, z: district.z + 10 }));
  let goal = brain.lastSeen && now - brain.seenAt < 3500 ? brain.lastSeen : patrols[brain.patrol % patrols.length];
  if (!isBombRound(state) && !target && enemies.length) {
    const pursuit = enemies[brain.patrol % Math.min(3, enemies.length)]; goal = approachPoint(pursuit, brain, state, pursuit.id, 9, bot);
  }
  let interacting = false;
  if (state.mode === 'hill' && state.hill) goal = approachPoint(state.hill.position, brain, state, 'control-hill', state.hill.radius * 0.55, bot);
  if (isBombRound(state)) {
    if (state.bomb.planted && state.bomb.position) {
      const position = state.bomb.position;
      const defenders = players.filter(player => player.hp > 0 && player.team === 'CT').sort((first, second) => Math.hypot(first.x - position.x, first.z - position.z) - Math.hypot(second.x - position.x, second.z - position.z));
      const defuser = defenders.find(player => player.id === state.bomb.actor) || defenders[0];
      goal = bot.id === defuser?.id ? position : approachPoint(position, brain, state, 'planted-bomb', bot.team === 'CT' ? 7 : 10, bot);
      if (bot.id === defuser?.id && Math.hypot(bot.x - position.x, bot.z - position.z) < 2.3) interacting = true;
    } else if (bot.team === 'T') {
      const carrier = players.find(player => player.id === state.bomb.carrier);
      const site = sites[(state.round + brain.patrol) % sites.length];
      goal = state.bomb.position || (carrier?.id !== bot.id && carrier ? approachPoint(carrier, brain, state, carrier.id, 4 + brain.seed % 4, bot) : site);
      if (state.bomb.carrier === bot.id && sites.some(site => Math.hypot(bot.x - site.x, bot.z - site.z) < 3.7)) interacting = true;
    } else goal = approachPoint(sites[brain.patrol % sites.length], brain, state, `site-${brain.patrol % sites.length}`, brain.role === 'anchor' ? 5 : 9, bot);
  }
  if (Math.hypot(bot.x - goal.x, bot.z - goal.z) < 2 && !interacting) { brain.patrol++; if (state.mode === 'deathmatch') goal = patrols[brain.patrol % patrols.length]; }
  const goalChanged = !brain.goal || Math.hypot(goal.x - brain.goal.x, goal.z - brain.goal.z) > 4;
  const blockedByFire = brain.path[0] && state.fires?.some(fire => fire.cells.some(point => Math.hypot(point.x - brain.path[0].x, point.z - brain.path[0].z) < 1.8));
  if (!interacting && (goalChanged || now >= brain.nextPlan && (!brain.path.length || blockedByFire))) {
    brain.path = planBotRoute(bot, players, state, brain, goal); brain.goal = { x: goal.x, y: goal.y, z: goal.z }; brain.nextPlan = now + 1500 + brain.routeId % 5 * 130;
  }
  while (brain.path.length && Math.hypot(bot.x - brain.path[0].x, bot.z - brain.path[0].z) < 0.5) brain.path.shift();
  const waypoint = brain.path[0];
  if (waypoint && waypoint.y - bot.y > 0.3 && bot.grounded) input.jump = true;
  const walkingYaw = waypoint ? Math.atan2(bot.x - waypoint.x, bot.z - waypoint.z) : bot.yaw;
  if (target) {
    const error = state.mode === 'ranked' ? 0.028 - rankedSkill * 0.001 : difficulty === 'easy' ? 0.065 : difficulty === 'hard' ? 0.014 : 0.035;
    const desired = Math.atan2(bot.x - target.x, bot.z - target.z) + Math.sin(now / 430 + brain.patrol) * error;
    input.yaw = bot.yaw + Math.atan2(Math.sin(desired - bot.yaw), Math.cos(desired - bot.yaw)) * (difficulty === 'hard' ? 0.23 : 0.12);
    const height = target.y + (target.crouch ? 0.85 : 1.14) - bot.y - eyeHeight(bot.crouch);
    const desiredPitch = Math.atan2(height, Math.hypot(bot.x - target.x, bot.z - target.z)) + Math.cos(now / 570 + brain.patrol) * error * 0.55;
    input.pitch = bot.pitch + (desiredPitch - bot.pitch) * 0.16;
    const range = Math.hypot(bot.x - target.x, bot.z - target.z);
    input.scope = !!WEAPONS[bot.weapon].scope && range > 10;
    if (brain.role === 'support' && now >= brain.nextUtility && now >= brain.reactAt && range > 10 && range < 24 && Math.abs(desired - input.yaw) < 0.25) {
      input.utility = bot.grenades.flashbang ? 'flashbang' : bot.grenades.smoke ? 'smoke' : bot.grenades.grenade ? 'grenade' : undefined;
      if (input.utility) brain.nextUtility = now + 12000;
    }
    if (!interacting && now >= brain.reactAt && now >= brain.nextShot && Math.abs(Math.atan2(Math.sin(desired - input.yaw), Math.cos(desired - input.yaw))) < 0.15 && !bot.reloading) {
      input.fire = true; brain.nextShot = now + Math.max(WEAPONS[bot.weapon].interval, difficulty === 'easy' ? 520 : difficulty === 'hard' ? 210 : 340) + (brain.patrol % 4) * 55;
    }
  } else { input.yaw = walkingYaw; input.pitch = 0; }
  if (waypoint && !interacting && (!target || Math.hypot(bot.x - target.x, bot.z - target.z) > 8 || state.hill && Math.hypot(bot.x - state.hill.position.x, bot.z - state.hill.position.z) > state.hill.radius * 0.8)) {
    const delta = walkingYaw - input.yaw;
    input.forward = Math.cos(delta) * 0.85; input.side = -Math.sin(delta) * 0.85;
  }
  input.reload = bot.ammo[bot.weapon] < Math.max(1, WEAPONS[bot.weapon].capacity * 0.15) && !bot.reloading;
  if (!interacting) {
    const separation = teammateSeparation(bot, players, state.map);
    input.forward += (-Math.sin(input.yaw) * separation.x - Math.cos(input.yaw) * separation.z) * 0.9;
    input.side += (Math.cos(input.yaw) * separation.x - Math.sin(input.yaw) * separation.z) * 0.9;
    input.forward = Math.max(-1, Math.min(1, input.forward)); input.side = Math.max(-1, Math.min(1, input.side));
    if (bot.reloading && target) { input.forward = -0.35; input.sprint = false; }
    if (target && brain.role === 'anchor' && Math.hypot(bot.x - target.x, bot.z - target.z) < 24) { input.crouch = true; input.sprint = false; }
  }
  input.interact = interacting; if (interacting) { input.fire = false; input.reload = false; }
  return input;
}