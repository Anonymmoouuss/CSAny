import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer, getSites, MAPS, MAP_SIZE, MAP_AREA_MULTIPLIER, spawn, spawnPoints, walkable, type Player } from '../shared/game.ts';
import { beginRound, finishRound, interactBomb, isBombRound, recordModeKill, advanceRound, dropBomb, dropWeapon, pickupWeapon, emptyBomb, canPurchase, purchaseEquipment, matchLineup, BUY_WINDOW, type RoundState } from '../shared/round.ts';
import { GUN_GAME_ORDER } from '../shared/modes.ts';
import { advanceEquipment, createSmokeVolume, cutSmoke, flashExposure, flashPresentation, smokeBlocks, throwEquipment } from '../shared/equipment.ts';
import { botInput, createBrain, navigate, teammateSeparation, visible } from '../shared/bots.ts';

function setup() {
  const players = [createPlayer('t1', 'Alpha', 'T', 'defusal', 0), createPlayer('t2', 'Bravo', 'T', 'defusal', 1), createPlayer('ct', 'Charlie', 'CT', 'defusal', 2)];
  const state: RoundState = { mode: 'defusal', map: 'dustline', phase: 'waiting', endsAt: 0, score: { T: 0, CT: 0 }, bomb: emptyBomb(), round: 0, events: [] };
  beginRound(state, players, 1000, () => 0); state.phase = 'live'; state.endsAt = 116000;
  Object.assign(players[0], getSites('dustline')[0]);
  return { state, players };
}
function hold(state: RoundState, player: Player, duration: number, start: number) {
  for (let step = 0; step < duration / 10; step++) interactBomb(state, player, true, 10, start + step * 10);
}

test('only one randomly assigned carrier plants and release/movement interrupts', () => {
  const { state, players } = setup(); assert.equal(state.bomb.carrier, 't1');
  Object.assign(players[1], getSites('dustline')[0]); hold(state, players[1], 4000, 2000); assert.equal(state.bomb.planted, false);
  hold(state, players[0], 1000, 2000); assert.ok(state.bomb.progress > 0);
  interactBomb(state, players[0], false, 10, 3010); assert.equal(state.bomb.progress, 0);
  hold(state, players[0], 3500, 4000); assert.equal(state.bomb.planted, true); assert.equal(state.bomb.carrier, null);
  assert.equal(state.events.find(event => event.text === 'Bomb planted')?.id, 't1');
  assert.equal(state.bomb.endsAt, 47490);
});

test('defuse takes ten seconds without kit and five with kit', () => {
  for (const kit of [false, true]) {
    const { state, players } = setup(); hold(state, players[0], 3500, 2000);
    Object.assign(players[2], state.bomb.position); players[2].kit = kit;
    const duration = kit ? 5000 : 10000;
    hold(state, players[2], duration - 10, 6000); assert.equal(state.phase, 'live');
    interactBomb(state, players[2], true, 10, 6000 + duration); assert.equal(state.phase, 'over'); assert.equal(state.winner, 'CT');
  }
});

test('planted bomb survives T elimination, bypasses round timeout, explodes once and damages nearby players', () => {
  const { state, players } = setup(); hold(state, players[0], 3500, 2000);
  players[0].hp = players[1].hp = 0; state.endsAt = 7000;
  advanceRound(state, players, 8000); assert.equal(state.phase, 'live');
  Object.assign(players[2], state.bomb.position);
  advanceRound(state, players, state.bomb.endsAt); assert.equal(state.winner, 'T'); assert.equal(players[2].hp, 0);
  advanceRound(state, players, state.endsAt - 1); assert.equal(state.score.T, 1);
});

test('bomb drops can be recovered only by living T players', () => {
  const { state, players } = setup(); dropBomb(state, players[0]); assert.equal(state.bomb.carrier, null);
  Object.assign(players[2], state.bomb.position); interactBomb(state, players[2], true, 10, 2000); assert.equal(state.bomb.carrier, null);
  Object.assign(players[1], state.bomb.position); interactBomb(state, players[1], false, 10, 2010); assert.equal(state.bomb.carrier, players[1].id);
});

test('spawn purchases expire at 25 seconds and cannot be made away from the team start', () => {
  const { state, players } = setup(); beginRound(state, players, 1000);
  assert.equal(state.buyEndsAt, 1000 + BUY_WINDOW);
  assert.equal(canPurchase(state, players[0], 2000), true);
  const origin = { x: players[0].x, y: players[0].y, z: players[0].z };
  Object.assign(players[0], { x: 0, z: 0 }); assert.equal(canPurchase(state, players[0], 2000), false);
  Object.assign(players[0], origin); assert.equal(canPurchase(state, players[0], 26000), false);
});

test('elimination waits for the next round to revive players and stops at five wins', () => {
  const { state, players } = setup(); state.mode = 'elimination';
  for (let round = 0; round < 5; round++) {
    beginRound(state, players, 1000 + round * 20000); advanceRound(state, players, state.endsAt);
    players.filter(player => player.team === 'T').forEach(player => { player.hp = 0; });
    advanceRound(state, players, 7000 + round * 20000);
    assert.equal(state.phase, 'over'); assert.equal(state.score.CT, round + 1);
    assert.equal(players[0].hp, 0); assert.equal(players[0].respawnAt, 0);
  }
  const round = state.round; advanceRound(state, players, 999999);
  assert.equal(state.matchWinner, 'CT'); assert.equal(state.round, round); assert.equal(state.phase, 'over');
});

test('defusal alternates bomb and elimination rounds and finishes after exactly four', () => {
  const { state, players } = setup(); state.round = 0; state.score = { CT: 0, T: 0 };
  for (let round = 1; round <= 4; round++) {
    beginRound(state, players, round * 20000, () => 0);
    assert.equal(isBombRound(state), round % 2 === 1); assert.equal(!!state.bomb.carrier, round % 2 === 1);
    finishRound(state, players, round % 2 ? 'CT' : 'T', round * 20000 + 1000);
  }
  assert.equal(state.matchComplete, true); assert.equal(state.matchDraw, true); assert.equal(state.endsAt, 0);
  advanceRound(state, players, 999999); assert.equal(state.round, 4);
});

test('hill control counts one team once, pauses while contested and wins at 250 seconds', () => {
  const { state, players } = setup(); state.mode = 'hill'; state.round = 0; beginRound(state, players, 1000);
  const hill = state.hill!; Object.assign(players[0], hill.position); Object.assign(players[1], hill.position); Object.assign(players[2], { x: hill.position.x + 20, y: hill.position.y, z: hill.position.z });
  advanceRound(state, players, 1100); assert.equal(hill.held.T, 100);
  Object.assign(players[2], hill.position); advanceRound(state, players, 1200); assert.equal(hill.contested, true); assert.equal(hill.held.T, 100);
  players[2].hp = 0;
  for (let tick = 1; tick <= 2500; tick++) advanceRound(state, players, 1200 + tick * 100);
  assert.equal(hill.held.T, 250000); assert.equal(state.matchWinner, 'T'); assert.equal(state.matchComplete, true);
});

test('Gun Game starts spread players apart even when their nominal teams match', () => {
  const players = Array.from({ length: 10 }, (_, index) => createPlayer(`ffa-${index}`, 'Player', 'CT', 'gungame', index));
  const state: RoundState = { mode: 'gungame', map: 'dustline', phase: 'waiting', endsAt: 0, score: { T: 0, CT: 0 }, bomb: emptyBomb(), round: 0, events: [] };
  beginRound(state, players, 1000);
  for (const player of players) { assert.ok(walkable(player.x, player.z, state.map)); for (const other of players) if (player !== other) assert.ok(Math.hypot(player.x - other.x, player.z - other.z) > 12); }
});

test('gun game advances one weapon per kill, wins on final tier and selects timeout leader', () => {
  const { state, players } = setup(); state.mode = 'gungame'; state.round = 0; beginRound(state, players, 1000);
  assert.equal(state.endsAt, 301000); assert.equal(players[0].weapon, GUN_GAME_ORDER[0]);
  for (let tier = 0; tier < GUN_GAME_ORDER.length; tier++) { assert.equal(players[0].weapon, GUN_GAME_ORDER[tier]); players[0].kills++; recordModeKill(state, players, players[0], GUN_GAME_ORDER[tier], 2000 + tier * 1000); }
  assert.equal(state.winnerId, players[0].id); assert.equal(state.matchComplete, true);
  beginRound(state, players, 100000); players[1].kills++; recordModeKill(state, players, players[1], players[1].weapon, 101000);
  advanceRound(state, players, state.endsAt); assert.equal(state.winnerId, players[1].id);
});

test('purchases replace one loadout slot and dropped weapons retain ammunition on pickup', () => {
  const { state, players } = setup(); beginRound(state, players, 1000);
  const player = players[0]; player.money = 16000;
  assert.equal(purchaseEquipment(state, player, 'rifle', 2000), null);
  player.ammo.rifle = 7;
  assert.equal(purchaseEquipment(state, player, 'sniper', 2100), null);
  assert.deepEqual(new Set(player.owned), new Set(['pistol', 'knife', 'sniper']));
  assert.equal(state.drops?.[0].weapon, 'rifle'); assert.equal(state.drops?.[0].ammo, 7);
  assert.equal(pickupWeapon(state, player, 2200), false);
  assert.equal(pickupWeapon(state, player, 2800), true);
  assert.equal(player.weapon, 'rifle'); assert.equal(player.ammo.rifle, 7);
  assert.deepEqual(new Set(player.owned), new Set(['pistol', 'knife', 'rifle']));
  assert.equal(state.drops?.[0].weapon, 'sniper');
  assert.equal(dropWeapon(state, player, 'knife', 2900), false);
  const money = player.money; player.money = 0;
  assert.equal(purchaseEquipment(state, player, 'carbine', 3000), 'INSUFFICIENT MATCH SUPPLY');
  assert.equal(player.weapon, 'rifle'); assert.equal(state.drops?.length, 1); player.money = money;
});

test('dropped weapons fall, bounce and settle on collision while preserving ammunition', () => {
  const { state, players } = setup(); const player = players[0]; Object.assign(player, { x: 0, y: 0, z: 5, yaw: 0 });
  player.owned.push('rifle'); player.weapon = 'rifle'; player.ammo.rifle = 9;
  assert.equal(dropWeapon(state, player, 'rifle', 10000), true); const drop = state.drops![0];
  assert.ok(drop.y > 0.9);
  for (let tick = 1; tick <= 240; tick++) advanceRound(state, players, 10000 + tick * 1000 / 64);
  assert.equal(drop.settled, true); assert.ok(drop.y >= 0.04 && drop.y < 0.12); assert.ok(drop.z < 5); assert.equal(drop.ammo, 9);
  assert.ok([drop.x, drop.y, drop.z, drop.vx, drop.vy, drop.vz].every(Number.isFinite));
});

test('defuse kits require CT bomb mode and utility is capped at three items', () => {
  const { state, players } = setup(); beginRound(state, players, 1000);
  for (const player of players) player.money = 16000;
  assert.equal(purchaseEquipment(state, players[0], 'kit', 2000), 'DEFUSAL COUNTER-TERRORIST EQUIPMENT ONLY');
  state.mode = 'elimination';
  assert.equal(purchaseEquipment(state, players[2], 'kit', 2000), 'DEFUSAL COUNTER-TERRORIST EQUIPMENT ONLY');
  state.mode = 'defusal'; assert.equal(purchaseEquipment(state, players[2], 'kit', 2000), 'DEFUSAL COUNTER-TERRORIST EQUIPMENT ONLY');
  state.round++; assert.equal(purchaseEquipment(state, players[2], 'kit', 2000), null);
  assert.equal(purchaseEquipment(state, players[0], 'grenade', 2000), null);
  assert.equal(purchaseEquipment(state, players[0], 'flashbang', 2000), null);
  assert.equal(purchaseEquipment(state, players[0], 'flashbang', 2000), null);
  assert.equal(purchaseEquipment(state, players[0], 'flashbang', 2000), 'EQUIPMENT LIMIT REACHED');
  assert.equal(purchaseEquipment(state, players[0], 'grenade', 2000), 'EQUIPMENT LIMIT REACHED');
});

test('the winning team forms a V with its best player in the center for victory or defeat', () => {
  const players = Array.from({ length: 10 }, (_, index) => createPlayer(`lineup-${index}`, 'Player', index < 5 ? 'CT' : 'T', 'elimination', index));
  players[3].kills = 12; players[8].kills = 15;
  for (const team of ['CT', 'T'] as const) {
    const lineup = matchLineup(players, team); assert.equal(lineup.length, 5); assert.equal(lineup[0].x, 0); assert.equal(lineup[0].z, 0);
    assert.equal(lineup[0].player.id, team === 'CT' ? 'lineup-3' : 'lineup-8');
    assert.ok(lineup.every(entry => entry.player.team === team));
    assert.ok(lineup[1].x < 0 && lineup[2].x > 0 && lineup[3].z < lineup[1].z);
  }
});

test('bots react after acquiring a target rather than firing on the first visible frame', () => {
  const { state, players } = setup(); state.mode = 'elimination';
  Object.assign(players[0], { x: 0, y: 0, z: 5, yaw: 0, pitch: 0 }); Object.assign(players[2], { x: 0, y: 0, z: 0 });
  const brain = createBrain(); assert.equal(visible(players[0], players[2], state.map), true);
  assert.equal(botInput(players[0], players, state, brain, 3000).fire, false);
  assert.equal(botInput(players[0], players, state, brain, 3400).fire, false);
  assert.equal(botInput(players[0], players, state, brain, 3600).fire, true);
  players[2].hp = 0; botInput(players[0], players, state, brain, 4000); players[2].hp = 100;
  assert.equal(botInput(players[0], players, state, brain, 5000).fire, false);
});

test('bots separate locally, choose distinct approach goals and vary routes between rounds', () => {
  const { state, players } = setup(); state.mode = 'elimination';
  Object.assign(players[0], { x: 0, y: 0, z: 5 }); Object.assign(players[1], { x: 0.6, y: 0, z: 5 }); Object.assign(players[2], { x: -20, y: 0, z: 0 });
  const separation = teammateSeparation(players[0], players, state.map); assert.ok(separation.x < 0);
  players[1].x = 2.2; assert.ok(teammateSeparation(players[0], players, state.map).x < 0, 'spacing begins before teammates form a tight clump'); players[1].x = 0.6;
  const first = createBrain(0, () => 0.2); const second = createBrain(1, () => 0.7);
  botInput(players[0], players, state, first, 3000); botInput(players[1], players, state, second, 3000);
  assert.notDeepEqual(first.goal, second.goal); assert.notEqual(first.routeId, second.routeId);
  const previous = first.routeId; state.round++; botInput(players[0], players, state, first, 4000); assert.notEqual(first.routeId, previous);
});

test('throwables respect purchase limits, inventory, fuses and wall occlusion', () => {
  const { state, players } = setup(); beginRound(state, players, 1000); const owner = players[0]; owner.money = 16000;
  assert.equal(purchaseEquipment(state, owner, 'grenade', 2000), null);
  assert.equal(purchaseEquipment(state, owner, 'grenade', 2000), 'EQUIPMENT LIMIT REACHED');
  const ammo = owner.ammo[owner.weapon]; state.phase = 'live'; Object.assign(owner, { x: 0, y: 0, z: 5, yaw: 0 });
  assert.equal(throwEquipment(state, owner, 'grenade', 10000), true); assert.equal(owner.grenades.grenade, 0); assert.equal(owner.ammo[owner.weapon], ammo);
  assert.equal(throwEquipment(state, owner, 'grenade', 11000), false);
  advanceEquipment(state, players, 50, 11000); assert.equal(state.projectiles?.length, 1);
  Object.assign(owner, { x: 30, z: 30 }); Object.assign(players[1], { x: 1, y: 0, z: 2 }); Object.assign(players[2], { x: 0, y: 0, z: 1 });
  Object.assign(state.projectiles![0], { x: 0, y: 0.1, z: 0, vx: 0, vy: 0, vz: 0 });
  advanceEquipment(state, players, 0, 12000); assert.equal(state.projectiles?.length, 0);
  assert.ok(players[2].hp < 100); assert.equal(players[1].hp, 100, 'friendly damage is disabled');
  assert.ok(state.events.some(event => event.type === 'explosion')); assert.ok(!state.events.some(event => event.type === 'shot'));
  players[2].hp = 100; Object.assign(players[2], { x: -14, y: 0, z: 0 });
  state.projectiles = [{ id: 'blocked', owner: owner.id, team: owner.team, kind: 'grenade', x: -10, y: 0.1, z: 0, vx: 0, vy: 0, vz: 0, fuseAt: 12000 }];
  advanceEquipment(state, players, 0, 13000); assert.equal(players[2].hp, 100, 'solid walls block blast damage');
});

test('flashbang strength depends on viewing direction and does not damage players', () => {
  const { state, players } = setup();
  Object.assign(players[0], { x: 0, y: 0, z: 4, yaw: 0 }); Object.assign(players[1], { x: 0, y: 0, z: 4, yaw: Math.PI }); Object.assign(players[2], { x: 30, z: 30 });
  state.projectiles = [{ id: 'flash', owner: players[2].id, team: 'CT', kind: 'flashbang', x: 0, y: 1.4, z: 0, vx: 0, vy: 0, vz: 0, fuseAt: 10000 }];
  advanceEquipment(state, players, 0, 10000);
  assert.ok(players[0].flashStrength > players[1].flashStrength * 2); assert.ok(players[0].flashedUntil > 10000);
  assert.equal(players[0].hp, 100); assert.equal(players[1].hp, 100);
});

test('flashbangs hold a strong forward whiteout, recover gradually and respect walls and comfort settings', () => {
  const player = createPlayer('flash-test', 'Flash', 'CT', 'deathmatch', 0); Object.assign(player, { x: 0, y: 0, z: 4, yaw: 0, pitch: 0 });
  const point = { x: 0, y: 1.5, z: 0 }; const forward = flashExposure(player, point, 'dustline'); assert.equal(forward.strength, 1); assert.ok(forward.hold >= 1500); assert.ok(forward.duration > 5000);
  player.yaw = Math.PI; assert.ok(flashExposure(player, point, 'dustline').strength < 0.2);
  Object.assign(player, { x: -20, z: 0, yaw: -Math.PI / 2 }); assert.equal(flashExposure(player, { x: 0, y: 1.5, z: 0 }, 'dustline').strength, 0);
  Object.assign(player, { flashStrength: 1, flashHoldUntil: 11800, flashedUntil: 15900 });
  assert.equal(flashPresentation(player, 11000).opacity, 1); const recovery = flashPresentation(player, 13500); assert.ok(recovery.opacity > 0 && recovery.opacity < 1); assert.ok(recovery.recovery > 0.5); assert.ok(recovery.muffle > 0);
  assert.ok(flashPresentation(player, 11000, true).opacity <= 0.35); assert.equal(flashPresentation(player, 13500, true).recovery, 0);
  assert.deepEqual(flashPresentation(player, 15900), { opacity: 0, recovery: 0, muffle: 0 });
});

test('voxel smoke stays behind walls, blocks sight and temporarily opens along bullets', () => {
  const cloud = createSmokeVolume('dustline', { x: -10, y: 0.4, z: 0 }, 1000, 'smoke-test');
  assert.ok(cloud.cells.length > 20 && cloud.cells.length <= 512); assert.ok(cloud.cells.every(cell => cell.x > -11.47));
  const state = { smokes: [cloud] }; const from = { x: -10, y: 1, z: 5 }; const to = { x: -10, y: 1, z: -5 };
  assert.equal(smokeBlocks(state, from, to, 1100), true);
  cutSmoke(state, from, to, 1200); assert.equal(smokeBlocks(state, from, to, 1250), false);
  assert.equal(smokeBlocks(state, from, to, 1600), true); assert.equal(smokeBlocks(state, from, to, 20000), false);
});

test('incendiaries follow nearby floors and damage enemies without burning teammates', () => {
  const { state, players } = setup();
  Object.assign(players[0], { x: 0, y: 0, z: 5 }); Object.assign(players[1], { x: 0, y: 0, z: 1 }); Object.assign(players[2], { x: 1, y: 0, z: 1 });
  state.projectiles = [{ id: 'fire-test', owner: players[0].id, team: 'T', kind: 'molotov', x: 0, y: 0.1, z: 0, vx: 0, vy: 0, vz: 0, fuseAt: 1000 }];
  advanceEquipment(state, players, 0, 1000); assert.ok(state.fires?.[0].cells.length); advanceEquipment(state, players, 100, 1100);
  assert.equal(players[1].hp, 100); assert.equal(players[2].hp, 96);
  advanceEquipment(state, players, 100, 9000); assert.equal(state.fires?.length, 0);
});

test('all four expanded maps have clear non-stacking spawns and safe deathmatch selection', () => {
  assert.ok(Math.abs((MAP_SIZE * 2) ** 2 / (80 ** 2) - MAP_AREA_MULTIPLIER) < 1e-12);
  for (const map of Object.values(MAPS).filter(map => !map.imported && map.id !== 'training').map(map => map.id)) {
    assert.ok(MAPS[map].solids.length > 150);
    assert.ok(getSites(map).every(site => walkable(site.x, site.z, map, 2)));
    assert.ok(spawnPoints('T', map).length >= 10); assert.ok(spawnPoints('CT', map).length >= 10);
    const players = Array.from({ length: 10 }, (_, index) => createPlayer(`p${index}`, 'Player', index % 2 ? 'T' : 'CT', 'deathmatch', index));
    for (const [index, player] of players.entries()) spawn(player, index, map, players);
    for (const player of players) {
      assert.ok(walkable(player.x, player.z, map));
      assert.ok(players.every(other => other === player || Math.hypot(player.x - other.x, player.z - other.z) > 1.2));
    }
    const enemy = players.find(player => player.team === 'T')!;
    Object.assign(enemy, { x: -33, z: -33 }); spawn(players[0], 0, map, [enemy], true);
    assert.ok(Math.hypot(players[0].x - enemy.x, players[0].z - enemy.z) > 35);
  }
});

test('A* bot routes stay clear of walls and bot carrier plants when reaching a site', () => {
  for (const map of Object.values(MAPS).filter(map => !map.imported && map.id !== 'training').map(map => map.id)) {
    const from = { x: -100, y: 0, z: 100 }; const to = { x: 100, y: 0, z: -100 };
    const path = navigate(map, from, to); assert.ok(path.length > 80, map);
    assert.ok(path.every(point => walkable(point.x, point.z, map)), map);
    for (let index = 1; index < path.length; index++) assert.ok(walkable((path[index - 1].x + path[index].x) / 2, (path[index - 1].z + path[index].z) / 2, map), `${map} segment ${index}`);
  }
  const { state, players } = setup();
  assert.equal(botInput(players[0], players, state, createBrain(), 3000).interact, true);
  Object.assign(players[2], { x: 0, y: 0, z: 0 }); Object.assign(players[0], { x: -20, y: 0, z: 0 });
  assert.equal(visible(players[0], players[2], 'dustline'), false);
});

test('bots complete planting and defusing through the same held-input rules as humans', () => {
  const { state, players } = setup(); const carrier = players[0]; const defender = players[2]; const attacking = createBrain(0, () => 0.2);
  Object.assign(defender, { x: 0, y: 0, z: 0 });
  for (let tick = 0; tick < 225; tick++) { const now = 10000 + tick * 1000 / 64; const input = botInput(carrier, players, state, attacking, now); interactBomb(state, carrier, input.interact, 1000 / 64, now, players); }
  assert.equal(state.bomb.planted, true); Object.assign(defender, state.bomb.position); defender.kit = true; const defending = createBrain(1, () => 0.7);
  for (let tick = 0; tick < 321 && state.phase === 'live'; tick++) { const now = 14000 + tick * 1000 / 64; const input = botInput(defender, players, state, defending, now); interactBomb(state, defender, input.interact, 1000 / 64, now, players); }
  assert.equal(state.winner, 'CT'); assert.ok(state.events.some(event => event.text === 'Bomb defused'));
});