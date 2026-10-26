import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { BoxGeometry, PerspectiveCamera, Ray, Vector3 } from 'three';
import { createGameServer } from '../server/game.ts';
import { createPlayer, damageAtRange, direction, scopedFov, shotDirection, hitPlayer, hitMelee, simulateMovement, wallHit, SUPPLIED_MAP_IDS, MAX_HOP_SPEED, WEAPONS, type Input, type Snapshot } from '../shared/game.ts';
import { fireHitscan, traceBallisticPath } from '../shared/combat.ts';
import { encodeMapGeometry, registerMapGeometry, type SurfaceMaterial } from '../shared/map-geometry.ts';
import { encodeInputs, decodeInputs, HitboxHistory } from '../shared/protocol.ts';
import { advanceTraining, configureRange, createTraining, recordTrainingShot, TRAINING_MAP } from '../shared/training.ts';
import { InputButtons } from '../client/input.ts';
import { Network } from '../client/network.ts';

const input = (seq: number, extra: Partial<Input> = {}): Input => ({
  seq, time: Date.now(), forward: 0, side: 0, yaw: 0, pitch: 0, jump: false, crouch: false,
  sprint: false, fire: false, reload: false, scope: false, interact: false, weapon: 'rifle', ...extra,
});
type Message = Snapshot | { type: string; [key: string]: unknown };
function waitFor(socket: WebSocket, predicate: (message: any) => boolean, timeout = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('message', listener); reject(new Error('Message timed out')); }, timeout);
    function listener(data: Buffer) {
      const message: Message = JSON.parse(data.toString());
      if (predicate(message)) { clearTimeout(timer); socket.off('message', listener); resolve(message); }
    }
    socket.on('message', listener);
  });
}

test('quick fire presses survive release before a simulation tick and clear on focus loss', () => {
  const buttons = new InputButtons();
  buttons.add('fire'); buttons.delete('fire');
  assert.equal(buttons.consumeFire(), true); assert.equal(buttons.consumeFire(), false);
  buttons.add('fire'); assert.equal(buttons.consumeFire(), true); assert.equal(buttons.consumeFire(), true);
  buttons.delete('fire'); assert.equal(buttons.consumeFire(), false);
  buttons.add('fire'); buttons.add('KeyW'); buttons.clear();
  assert.equal(buttons.consumeFire(), false); assert.equal(buttons.has('KeyW'), false);
});

test('stationary rifle first shot matches the camera crosshair at every pitch', () => {
  const player = createPlayer('aim', 'Aim', 'T', 'deathmatch', 0);
  player.weapon = 'rifle';
  const camera = new PerspectiveCamera();
  camera.rotation.order = 'YXZ';
  for (const pitch of [-1, -0.3, 0, 0.6, 1.2]) {
    const aim = input(0, { yaw: 0.7, pitch });
    camera.rotation.set(pitch, aim.yaw, 0);
    const cameraRay = camera.getWorldDirection(new Vector3());
    assert.ok(shotDirection(player, aim, 10000).distanceTo(cameraRay) < 1e-10);
  }
});

test('binary commands preserve microsecond timing and actions and reject malformed packets', () => {
  const commands = Array.from({ length: 6 }, (_, index) => input(index, { time: 10000 + index * 15.625, yaw: 0.75, pitch: -0.43, forward: 0.7, side: -0.3, fire: true, jump: index === 2 }));
  const packet = encodeInputs(commands); const decoded = decodeInputs(packet);
  assert.ok(packet.byteLength < JSON.stringify(commands).length / 4); assert.equal(decoded.length, 6);
  for (const [index, command] of decoded.entries()) {
    assert.ok(Math.abs(command.time - commands[index].time) < 0.0011); assert.ok(Math.abs(command.yaw - 0.75) < 0.0001);
    assert.equal(command.fire, true); assert.equal(command.jump, index === 2); assert.equal(command.weapon, 'rifle'); assert.ok(Math.abs(command.forward - 0.7) < 0.005);
  }
  assert.throws(() => decodeInputs(packet.subarray(0, packet.length - 1)));
  const badWeapon = packet.slice(); badWeapon[28] = 255; assert.throws(() => decodeInputs(badWeapon));
  assert.throws(() => encodeInputs([input(0, { time: Infinity })]));
});

test('circular hitbox history interpolates sub-tick poses and avoids interpolation across respawns', () => {
  const player = createPlayer('history', 'History', 'CT', 'deathmatch', 0); const history = new HitboxHistory(4);
  Object.assign(player, { x: 0, y: 0, z: 0 }); history.push(1000, [player]); player.x = 2; history.push(1015.625, [player]);
  assert.ok(Math.abs(history.sample(1007.8125).get(player.id)!.x - 1) < 1e-9);
  player.deaths++; player.x = 90; history.push(1031.25, [player]);
  assert.equal(history.sample(1020).has(player.id), false);
  for (let index = 0; index < 10; index++) { player.x = index; history.push(1100 + index * 15.625, [player]); }
  assert.equal(history.sample(5000).get(player.id)?.x, 9); history.clear(); assert.equal(history.sample(5000).size, 0);
});

test('weapon optics have distinct magnification and reticles and respect base FOV', () => {
  const weapons = ['bullpup', 'scout', 'marksman', 'sniper', 'heavySniper'] as const;
  assert.equal(new Set(weapons.map(id => scopedFov(id, 90).toFixed(3))).size, 5);
  assert.equal(new Set(weapons.map(id => WEAPONS[id].scope!.reticle)).size, 4);
  for (const id of weapons) { assert.ok(scopedFov(id, 90) > 0 && scopedFov(id, 90) < 90); assert.ok(scopedFov(id, 100) > scopedFov(id, 80)); }
  assert.ok(Math.abs(scopedFov('rifle', 90) - 90) < 1e-10); assert.equal(WEAPONS.pistol.scope, undefined);
});

test('stationary scoped sniper has no spread; moving and unscoped shots do', () => {
  const player = createPlayer('scope', 'Scope', 'CT', 'deathmatch', 0);
  player.weapon = 'sniper';
  const aim = input(0, { scope: true });
  assert.deepEqual(shotDirection(player, aim, 10000), direction(0, 0));
  assert.ok(shotDirection(player, { ...aim, scope: false }, 10000, () => 0.5).distanceTo(direction(0, 0)) > 0.01);
  player.weapon = 'rifle';
  assert.ok(shotDirection(player, { ...aim, forward: 1 }, 10000, () => 0.5).distanceTo(direction(0, 0)) > 0.001);
});

test('head, chest and limb ray hitboxes have distinct damage multipliers', () => {
  const player = createPlayer('target', 'Target', 'CT', 'deathmatch', 0);
  Object.assign(player, { x: 0, y: 0, z: 0 });
  for (const [height, multiplier] of [[1.55, 4], [1, 1], [0.3, 0.75]]) {
    const hit = hitPlayer(new Ray(new Vector3(0, height, 5), new Vector3(0, 0, -1)), player);
    assert.equal(hit?.multiplier, multiplier);
  }
});

test('shotguns emit twelve spread pellets for one shell and lose damage rapidly at range', () => {
  const shooter = createPlayer('pellets', 'Shotgun', 'CT', 'deathmatch', 0); const target = createPlayer('victim', 'Target', 'T', 'deathmatch', 1);
  Object.assign(shooter, { x: 0, y: 0, z: 4, weapon: 'shotgun', lastShot: 0 }); Object.assign(target, { x: 0, y: 0, z: 1, armor: 0 });
  let seed = 1234; const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
  const shot = fireHitscan(shooter, [target], input(0, { weapon: 'shotgun', pitch: -0.18 }), 10000, 'dustline', { random });
  assert.ok(shot); assert.equal(shot.events[0].points?.length, 12); assert.equal(new Set(shot.events[0].points?.map(point => `${point.x}:${point.y}`)).size, 12);
  assert.equal(shooter.ammo.shotgun, WEAPONS.shotgun.capacity - 1); assert.ok(target.hp < 70);
  assert.ok(damageAtRange('shotgun', 15) < damageAtRange('shotgun', 2) * 0.7);
  assert.ok(damageAtRange('sniper', 100) > damageAtRange('sniper', 2) * 0.85);
  assert.equal(damageAtRange('shotgun', 30), 0);
  assert.equal(fireHitscan(shooter, [target], input(1), 10001, 'dustline'), null);
});

test('sustained rifle fire follows its recoil table and recovers after a pause', () => {
  const player = createPlayer('recoil', 'Recoil', 'CT', 'deathmatch', 0); player.weapon = 'rifle';
  Object.assign(player, { x: 0, y: 0, z: 5 });
  const first = fireHitscan(player, [], input(0), 10000, 'dustline', { random: () => 0 });
  const second = fireHitscan(player, [], input(1), 10100, 'dustline', { random: () => 0 });
  const recovered = fireHitscan(player, [], input(2), 11000, 'dustline', { random: () => 0 });
  assert.ok(first && second && recovered); assert.ok(second.events[0].point!.y > first.events[0].point!.y);
  assert.ok(Math.abs(recovered.events[0].point!.y - first.events[0].point!.y) < 1e-8);
});

test('thin wood loses bullet energy while concrete and steel stop weak calibers', () => {
  for (const material of ['wood', 'concrete', 'steel'] as SurfaceMaterial[]) {
    const id = `ballistics-${material}` as import('../shared/game.ts').MapId;
    const wall = new BoxGeometry(4, 4, material === 'wood' ? 0.15 : 0.5).translate(0, 1.5, 0);
    registerMapGeometry(id, encodeMapGeometry(wall.getAttribute('position').array as Float32Array, new Uint32Array(wall.index!.array), { name: id, assetId: id, transform: [], bounds: [-2, -0.5, -1, 2, 3.5, 1], cell: 1, navigation: [], spawns: { T: [], CT: [] }, sites: [], triangles: wall.index!.count / 3, surfaces: [material], triangleSurfaces: Array(wall.index!.count / 3).fill(0) }));
    const trace = traceBallisticPath(id, new Ray(new Vector3(0, 1.5, 3), new Vector3(0, 0, -1)), material === 'wood' ? 'rifle' : 'pistol');
    if (material === 'wood') { assert.equal(trace.surfaces, 1); assert.ok(trace.multiplierAt(5) > 0 && trace.multiplierAt(5) < 1); }
    else { assert.equal(trace.surfaces, 0); assert.ok(trace.distance < 3); }
    wall.dispose();
  }
});

test('shared movement prevents wall clipping and normalizes diagonal speed', () => {
  const player = createPlayer('player', 'Player', 'T', 'deathmatch', 0);
  Object.assign(player, { x: 0, z: 0 });
  simulateMovement(player, input(0, { forward: 1, side: 1 }));
  assert.ok(Math.abs(Math.hypot(player.x, player.z) - 4.8 / 64) < 0.001);
  Object.assign(player, { x: 0, z: -23 });
  for (let index = 0; index < 120; index++) simulateMovement(player, input(index, { forward: 1, sprint: true }));
  assert.ok(player.z >= -39.21);
  assert.ok(wallHit(new Ray(new Vector3(0, 1.6, 0), new Vector3(-1, 0, 0)), 100) < 13);
});

test('Negev uses its existing model identity with a 150-round belt and explicit support stats', () => {
  assert.equal(WEAPONS.lmg.name, 'Negev'); assert.equal(WEAPONS.lmg.capacity, 150); assert.equal(WEAPONS.lmg.interval, 75); assert.equal(WEAPONS.lmg.price, 1700);
  const player = createPlayer('negev', 'Negev', 'CT', 'deathmatch', 0); assert.equal(player.ammo.lmg, 150); assert.equal(player.reserve.lmg, 450);
});

test('sprint flags cannot increase shared movement speed', () => {
  const walk = createPlayer('walk', 'Walk', 'CT', 'deathmatch', 0); const sprint = createPlayer('old-sprint', 'Old client', 'CT', 'deathmatch', 0);
  Object.assign(walk, { x: 0, y: 0, z: 5 }); Object.assign(sprint, { x: 0, y: 0, z: 5 });
  for (let tick = 0; tick < 32; tick++) { simulateMovement(walk, input(tick, { forward: 1 })); simulateMovement(sprint, input(tick, { forward: 1, sprint: true })); }
  assert.equal(sprint.x, walk.x); assert.equal(sprint.z, walk.z);
  assert.equal(decodeInputs(encodeInputs([input(9, { sprint: true })]))[0].sprint, false, 'reserved sprint bit cannot enable sprint');
});

test('holding jump chains bounded bunny hops and ground movement sheds hop momentum', () => {
  const player = createPlayer('hopper', 'Hopper', 'CT', 'training', 0); Object.assign(player, { x: 0, y: 0, z: 16 });
  let jumps = 0; let peak = 0;
  for (let tick = 0; tick < 320; tick++) {
    const grounded = player.grounded; simulateMovement(player, input(tick, { time: 10000 + tick * 1000 / 64, forward: 1, jump: true }), false, 'training');
    if (grounded && !player.grounded && player.vy > 0) jumps++;
    peak = Math.max(peak, Math.hypot(player.vx, player.vz));
  }
  assert.ok(jumps >= 5); assert.ok(peak > 5.5); assert.ok(peak <= MAX_HOP_SPEED + 0.0001);
  for (let tick = 320; tick < 440; tick++) simulateMovement(player, input(tick, { time: 10000 + tick * 1000 / 64, forward: 1 }), false, 'training');
  assert.ok(Math.hypot(player.vx, player.vz) <= 4.8001); assert.ok(Number.isFinite(player.y));
  simulateMovement(player, input(500, { jump: true, forward: 1 }), true, 'training'); assert.equal(player.vx, 0); assert.equal(player.vz, 0);
});

test('air strafing changes momentum without permitting unlimited speed or airborne jumping', () => {
  const player = createPlayer('air', 'Air strafe', 'CT', 'training', 0); Object.assign(player, { x: 0, y: 3, z: 10, grounded: false, vx: 0, vz: -4.8, vy: 0 });
  simulateMovement(player, input(1, { time: 10000, side: 1, jump: true }), false, 'training');
  assert.ok(player.vx > 0); assert.ok(player.vz < -4); assert.ok(player.vy < 0, 'jump cannot fire in mid-air');
  for (let tick = 0; tick < 20; tick++) simulateMovement(player, input(tick + 2, { time: 10016 + tick * 1000 / 64, side: 1, yaw: tick * 0.08 }), false, 'training');
  assert.ok(Math.hypot(player.vx, player.vz) <= MAX_HOP_SPEED + 0.0001);
});

test('knife sweep hits nearby off-centre targets but cannot reach distant players', () => {
  const target = createPlayer('target', 'Target', 'CT', 'deathmatch', 0);
  Object.assign(target, { x: 0.45, y: 0, z: -1.5 });
  const origin = new Vector3(0, 1.58, 0); const aim = direction(0, -0.1);
  assert.equal(hitPlayer(new Ray(origin, aim), target), null);
  assert.deepEqual(hitMelee(origin, aim, target)?.head, false);
  assert.equal(hitMelee(origin, aim, target)?.multiplier, 1);
  target.z = -5; assert.equal(hitMelee(origin, aim, target), null);
});

test('deployment grants a sidearm and knife, not unlocked cosmetic primaries', () => {
  for (const mode of ['deathmatch', 'defusal'] as const) {
    const player = createPlayer('deploy', 'Deploy', 'CT', mode, 0);
    assert.equal(player.weapon, 'pistol'); assert.deepEqual(player.owned, ['pistol', 'knife']);
    assert.equal(player.money, mode === 'deathmatch' ? 16000 : 800);
  }
});

test('aim training scores hits, tracks reaction and streaks, varies target difficulty and ends at one minute', () => {
  const player = createPlayer('operator', 'Operator', 'CT', 'training', 0); Object.assign(player, { x: 0, y: 0, z: 80 });
  const target = createPlayer('target', 'Target', 'T', 'training', 0);
  const easy = createTraining('easy', 1000); advanceTraining(easy, player, [target], 'dustline', 1000);
  assert.equal(easy.targetId, target.id); assert.equal(target.hp, 45);
  const point = { x: target.x, z: target.z }; advanceTraining(easy, player, [target], 'dustline', 1500);
  assert.equal(target.x, point.x); assert.equal(target.z, point.z);
  recordTrainingShot(easy, true, true, 1600); assert.equal(easy.kills, 1); assert.equal(easy.hits, 1); assert.equal(easy.reactionTotal, 600); assert.equal(easy.bestStreak, 1);
  recordTrainingShot(easy, false, false, 1700); assert.equal(easy.shots, 2); assert.equal(easy.streak, 0);
  const hard = createTraining('hard', 2000); advanceTraining(hard, player, [target], 'dustline', 2000); assert.equal(target.hp, 80);
  advanceTraining(hard, player, [target], 'dustline', 3900); assert.equal(target.hp, 0); assert.equal(hard.targetId, null);
  advanceTraining(easy, player, [target], 'dustline', 61000); assert.equal(easy.complete, true); assert.equal(target.hp, 0);
  const score = easy.score; recordTrainingShot(easy, true, true, 62000); assert.equal(easy.score, score);
});

test('the dedicated training arena keeps targets ahead and recoil range untimed', () => {
  const player = createPlayer('range', 'Range', 'CT', 'training', 0); Object.assign(player, { x: 0, y: 0, z: 16 });
  const target = createPlayer('range-target', 'Target', 'T', 'training', 1);
  const drill = createTraining('easy', 1000); advanceTraining(drill, player, [target], TRAINING_MAP, 1000);
  assert.equal(drill.targetId, target.id); assert.ok(target.z < player.z - 5);
  const range = createTraining('hard', 1000, 'range'); advanceTraining(range, player, [target], TRAINING_MAP, 1000);
  assert.equal(target.z, -14); assert.equal(target.hp, 10000);
  advanceTraining(range, player, [target], TRAINING_MAP, 90000); assert.equal(range.complete, false); assert.equal(target.z, -14); assert.equal(target.hp, 10000);
  assert.equal(configureRange(range, { distance: 40, armor: true, moving: true, health: 200 }, 100000), true);
  advanceTraining(range, player, [target], TRAINING_MAP, 100000); assert.equal(target.z, -24); assert.equal(target.armor, 100); assert.equal(target.hp, 200);
  advanceTraining(range, player, [target], TRAINING_MAP, 100500); assert.ok(Math.abs(target.x) > 0.1);
  configureRange(range, { distance: Infinity, health: -1 }, 101000); assert.equal(range.range?.distance, 40); assert.equal(range.range?.health, 200);
});

test('local practice chat emits sanitized messages for the visible chat popup', async () => {
  const network = new Network();
  try {
    network.startPractice({ name: 'Local chat', mode: 'training', trainingKind: 'range', map: 'training', skin: 0, knifeStyle: 0, owned: ['pistol', 'knife'], weapon: 'pistol' });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Local chat timed out')), 1000);
      network.onState = snapshot => { const event = snapshot.events.find(event => event.type === 'chat'); if (event) { clearTimeout(timer); assert.equal(event.text, 'hello range'); resolve(); } };
      network.send({ type: 'chat', text: '  hello\u0000 range  ' });
    });
  } finally { network.disconnect(); }
});

test('authoritative knife attacks emit melee events, retain ammo and respect reach', async () => {
  const game = createGameServer({ port: 0, host: '127.0.0.1' }); await once(game.http, 'listening');
  const address = game.http.address(); assert.ok(address && typeof address !== 'string');
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
  try {
    await once(socket, 'open'); const welcome = waitFor(socket, message => message.type === 'welcome');
    socket.send(JSON.stringify({ type: 'join', name: 'Knife', code: '', create: true }));
    const joined = await welcome; const room = game.rooms.get(joined.code)!; const attacker = room.clients.get(joined.id)!.player;
    room.map = 'dustline';
    for (const bot of room.bots) Object.assign(bot, { hp: 0, respawnAt: 0 });
    const target = room.bots[0]; Object.assign(target, { hp: 100, x: 0, y: 0, z: 0, reloading: Date.now() + 30000 });
    Object.assign(attacker, { weapon: 'knife', x: 0, y: 0, z: 5, lastShot: 0 }); room.history.clear();
    const missed = waitFor(socket, message => message.type === 'state' && message.events.some((event: any) => event.type === 'melee' && event.id === joined.id));
    socket.send(JSON.stringify({ type: 'inputs', inputs: [input(1, { weapon: 'knife', fire: true, pitch: -0.1 })] }));
    const miss = await missed as Snapshot; assert.equal(target.hp, 100); assert.ok(!miss.events.some(event => event.type === 'shot' && event.id === joined.id));
    Object.assign(target, { x: 0.45, z: 3.5 }); attacker.lastShot = 0; room.history.clear();
    const hit = waitFor(socket, message => message.type === 'state' && message.events.some((event: any) => event.type === 'hit' && event.id === joined.id));
    socket.send(JSON.stringify({ type: 'inputs', inputs: [input(2, { weapon: 'knife', fire: true, pitch: -0.1 })] }));
    const result = await hit as Snapshot; assert.ok(target.hp < 100); assert.equal(attacker.ammo.knife, 1);
    assert.ok(result.events.some(event => event.type === 'melee')); assert.ok(!result.events.some(event => event.type === 'shot' && event.id === joined.id));
  } finally { socket.close(); await game.close(); }
});

test('two real websocket clients join a room, register a headshot and respawn', async () => {
  const game = createGameServer({ port: 0, host: '127.0.0.1' });
  await once(game.http, 'listening');
  const address = game.http.address();
  assert.ok(address && typeof address !== 'string');
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const first = new WebSocket(url);
  const second = new WebSocket(url);
  try {
    await Promise.all([once(first, 'open'), once(second, 'open')]);
    const welcome = waitFor(first, message => message.type === 'welcome');
    first.send(JSON.stringify({ type: 'join', name: 'Alpha', code: '', create: true, weapon: 'sniper' }));
    const alpha = await welcome;
    assert.match(alpha.code, /^[A-F0-9]{6}$/);
    const otherWelcome = waitFor(second, message => message.type === 'welcome');
    second.send(JSON.stringify({ type: 'join', name: 'Bravo', code: alpha.code }));
    const bravo = await otherWelcome;
    const room = game.rooms.get(alpha.code)!;
    assert.equal(room.bots.length, 8);
    for (const team of ['T', 'CT']) assert.equal([...room.clients.values()].filter(client => client.player.team === team).length + room.bots.filter(bot => bot.team === team).length, 5);
    assert.equal(room.clients.size, 2);
    assert.equal(room.phase, 'live');
    const shooter = room.clients.get(alpha.id)!.player;
    const victim = room.clients.get(bravo.id)!.player;
    assert.equal(shooter.weapon, 'pistol'); assert.deepEqual(shooter.owned, ['pistol', 'knife']);
    const purchase = waitFor(first, message => message.type === 'state' && message.players.find((player: any) => player.id === alpha.id)?.owned.includes('rifle'));
    first.send(JSON.stringify({ type: 'buy', item: 'rifle' })); await purchase;
    assert.equal(shooter.money, 13300); assert.equal(shooter.weapon, 'rifle');
    const boughtGrenade = waitFor(first, message => message.type === 'state' && message.players.find((player: any) => player.id === alpha.id)?.grenades.grenade === 1);
    first.send(JSON.stringify({ type: 'buy', item: 'grenade' })); await boughtGrenade;
    const thrownGrenade = waitFor(first, message => message.type === 'state' && message.events.some((event: any) => event.type === 'throw' && event.id === alpha.id));
    first.send(JSON.stringify({ type: 'throw', item: 'grenade' })); const thrown = await thrownGrenade as Snapshot;
    assert.equal(shooter.grenades.grenade, 0); assert.equal(thrown.projectiles?.[0]?.owner, alpha.id);
    assert.ok(!thrown.events.some(event => event.type === 'shot' && event.id === alpha.id));
    room.map = 'dustline';
    Object.assign(shooter, { x: 0, y: 0, z: 5 });
    Object.assign(victim, { x: 0, y: 0, z: 0 });
    room.history.clear();
    const kill = waitFor(first, message => message.type === 'state' && message.events.some((event: any) => event.type === 'kill'));
    first.send(JSON.stringify({ type: 'inputs', inputs: [input(1, { fire: true, pitch: 0 })], position: { x: 1000 } }));
    const snapshot = await kill as Snapshot;
    const event = snapshot.events.find(event => event.type === 'kill')!;
    assert.equal(event.id, alpha.id); assert.equal(event.target, bravo.id); assert.equal(event.head, true);
    assert.equal(shooter.kills, 1); assert.equal(victim.deaths, 1); assert.equal(shooter.ammo.rifle, 29);
    assert.equal(shooter.x, 0, 'client cannot dictate its position');
    const respawn = await waitFor(second, message => message.type === 'state' && message.players.find((player: any) => player.id === bravo.id)?.hp === 100);
    assert.equal(respawn.players.find((player: any) => player.id === bravo.id).deaths, 1);
    const reload = waitFor(first, message => message.type === 'state' && message.players.find((player: any) => player.id === alpha.id)?.reloading > 0);
    first.send(JSON.stringify({ type: 'inputs', inputs: [input(2, { reload: true })] }));
    await reload;
    assert.ok(shooter.reloading > Date.now());
    const chat = waitFor(second, message => message.type === 'state' && message.events.some((event: any) => event.type === 'chat' && event.text === 'hello room'));
    first.send(JSON.stringify({ type: 'chat', text: 'hello room' }));
    await chat;
  } finally { first.close(); second.close(); await game.close(); }
});

test('online rooms randomly choose only supplied maps and create balanced five-player teams', async () => {
  const game = createGameServer({ port: 0, host: '127.0.0.1' }); await once(game.http, 'listening');
  const address = game.http.address(); assert.ok(address && typeof address !== 'string');
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
  try {
    await once(socket, 'open'); const welcome = waitFor(socket, message => message.type === 'welcome');
    socket.send(JSON.stringify({ type: 'join', name: 'Map test', code: '', create: true, map: 'dustline' }));
    const joined = await welcome; const room = game.rooms.get(joined.code)!;
    assert.ok(SUPPLIED_MAP_IDS.includes(room.map)); assert.notEqual(room.map, 'dustline'); assert.equal(room.bots.length, 9);
    const snapshot = await waitFor(socket, message => message.type === 'state') as Snapshot;
    for (const player of snapshot.players) {
      const ray = new Ray(new Vector3(player.x, player.y + 1.5, player.z), new Vector3(0, -1, 0));
      assert.ok(Math.abs(wallHit(ray, 3, room.map) - 1.5) < 0.05);
    }
    assert.equal(snapshot.players.filter(player => player.team === 'T').length, 5);
    assert.equal(snapshot.players.filter(player => player.team === 'CT').length, 5);
    assert.ok(snapshot.buyEndsAt! > snapshot.time);
  } finally { socket.close(); await game.close(); }
});

test('public matchmaking groups real players and keeps private codes isolated', async () => {
  const game = createGameServer({ port: 0, host: '127.0.0.1' }); await once(game.http, 'listening');
  const address = game.http.address(); assert.ok(address && typeof address !== 'string');
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const sockets: WebSocket[] = [];
  async function join(name: string, matchmaking: boolean, mode = 'deathmatch') {
    const socket = new WebSocket(url); sockets.push(socket); await once(socket, 'open');
    const welcome = waitFor(socket, message => message.type === 'welcome');
    socket.send(JSON.stringify({ type: 'join', name, code: '', create: true, matchmaking, mode }));
    return welcome;
  }
  try {
    const privateRoom = await join('Private', false); const first = await join('Public A', true); const second = await join('Public B', true);
    assert.equal(first.code, second.code); assert.notEqual(first.code, privateRoom.code);
    const room = game.rooms.get(first.code)!; assert.equal(room.visibility, 'public'); assert.equal(room.clients.size, 2); assert.equal(room.bots.length, 8);
    for (const team of ['CT', 'T']) assert.equal([...room.clients.values()].filter(client => client.player.team === team).length + room.bots.filter(bot => bot.team === team).length, 5);
    const bomb = await join('Bomb', true, 'defusal'); assert.notEqual(bomb.code, first.code);
    assert.equal(game.rooms.get(privateRoom.code)!.visibility, 'private');
    assert.ok(!SUPPLIED_MAP_IDS.includes('dust2'));
    for (const removed of ['sandstone', 'collection', 'outpost']) assert.ok(!SUPPLIED_MAP_IDS.includes(removed as typeof SUPPLIED_MAP_IDS[number]));
  } finally { for (const socket of sockets) socket.close(); await game.close(); }
});

test('Gun Game is authoritative free-for-all and purchases cannot skip its kill progression', async () => {
  const game = createGameServer({ port: 0, host: '127.0.0.1' }); await once(game.http, 'listening'); const address = game.http.address(); assert.ok(address && typeof address !== 'string');
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
  const reply = (stage: string, predicate: (message: any) => boolean) => waitFor(socket, predicate, 10000).catch(error => { throw new Error(`${stage}: ${error.message}`); });
  try {
    await once(socket, 'open'); const welcome = reply('map initialization', message => message.type === 'welcome'); socket.send(JSON.stringify({ type: 'join', name: 'Progression', code: '', create: true, mode: 'gungame' }));
    const joined = await welcome; const room = game.rooms.get(joined.code)!; room.map = 'dustline'; room.phase = 'live';
    const shooter = room.clients.get(joined.id)!.player; Object.assign(shooter, { x: 0, y: 0, z: 5, yaw: 0, pitch: 0, lastShot: 0 });
    for (const bot of room.bots) Object.assign(bot, { hp: 0, respawnAt: 0 });
    const target = room.bots[0]; Object.assign(target, { team: shooter.team, hp: 1, armor: 0, x: 0, y: 0, z: 0, reloading: Date.now() + 30000 }); room.history.clear();
    const killed = reply('required-weapon kill', message => message.type === 'state' && message.events.some((event: any) => event.type === 'kill' && event.id === joined.id));
    socket.send(JSON.stringify({ type: 'inputs', inputs: [input(1, { weapon: 'servicePistol', fire: true })] })); await killed;
    assert.equal(shooter.kills, 1); assert.equal(target.deaths, 1); assert.equal(room.gunGame!.levels[shooter.id], 1); assert.equal(shooter.weapon, 'pistol');
    const denied = reply('purchase rejection', message => message.type === 'error'); socket.send(JSON.stringify({ type: 'buy', item: 'heavySniper' })); assert.match((await denied).text, /GUN GAME/);
    const state = reply('equip rejection', message => message.type === 'state' && message.players.find((player: any) => player.id === joined.id)?.seq === 2);
    socket.send(JSON.stringify({ type: 'inputs', inputs: [input(2, { weapon: 'heavySniper' })] })); socket.send(JSON.stringify({ type: 'drop' })); await state;
    assert.equal(shooter.weapon, 'pistol'); assert.deepEqual(shooter.owned, ['pistol', 'knife']); assert.equal(room.drops?.length || 0, 0);
  } finally { socket.close(); await game.close(); }
});

test('ranked rooms require authenticated profiles and only group the same rank and skill', async () => {
  const game = createGameServer({ port: 0, host: '127.0.0.1' }); await once(game.http, 'listening'); const address = game.http.address(); assert.ok(address && typeof address !== 'string');
  const url = `ws://127.0.0.1:${address.port}/ws`; const sockets: WebSocket[] = [];
  async function join(name: string, account?: unknown) { const socket = new WebSocket(url); sockets.push(socket); await once(socket, 'open'); const reply = waitFor(socket, message => message.type === 'welcome' || message.type === 'error'); socket.send(JSON.stringify({ type: 'join', name, code: '', create: true, matchmaking: true, mode: 'ranked', account })); return reply; }
  try {
    assert.match((await join('Anonymous')).text, /REQUIRES A PROFILE/);
    const first = game.social.register('First'); const second = game.social.register('Second'); const high = game.social.register('Experienced');
    for (let match = 0; match < 12; match++) game.social.recordRankedResult(high.id, `past-${match}`, true, 1100, 20, 3);
    const alpha = await join('First', first); const bravo = await join('Second', second); const higher = await join('Experienced', high);
    assert.equal(alpha.code, bravo.code); assert.notEqual(alpha.code, higher.code);
    assert.match((await join('Duplicate', first)).text, /ACTIVE RANKED MATCH/);
    const room = game.rooms.get(higher.code)!; assert.ok(room.rankIndex! > 0); assert.ok(room.bots.every(bot => bot.botSkill === room.rankIndex));
    const match = game.rooms.get(alpha.code)!; assert.equal(match.mode, 'ranked');
    Object.assign(match, { phase: 'over', matchComplete: true, matchWinner: 'CT', endsAt: 0 });
    const finished = await waitFor(sockets[1], message => message.type === 'state' && message.matchComplete);
    assert.equal(game.social.rankedProfile(first.id).losses, 1); assert.equal(game.social.rankedProfile(second.id).wins, 1);
    await waitFor(sockets[1], message => message.type === 'state' && message.time > finished.time + 50);
    assert.equal(game.social.rankedProfile(first.id).matches, 1); assert.equal(game.social.rankedProfile(second.id).matches, 1);
  } finally { for (const socket of sockets) socket.close(); await game.close(); }
});

test('accepted 1v1 requests create authenticated two-player rooms without bots', async () => {
  const game = createGameServer({ port: 0, host: '127.0.0.1' }); await once(game.http, 'listening'); const address = game.http.address(); assert.ok(address && typeof address !== 'string');
  const base = `ws://127.0.0.1:${address.port}`; const sockets: WebSocket[] = [];
  async function open(path: string) { const socket = new WebSocket(base + path); sockets.push(socket); await once(socket, 'open'); return socket; }
  try {
    const first = game.social.register('First'); const second = game.social.register('Second'); const stranger = game.social.register('Stranger');
    game.social.requestFriend(first.id, second.id); game.social.replyFriend(second.id, first.id, true);
    const alpha = await open('/social'); const bravo = await open('/social');
    for (const [socket, credentials] of [[alpha, first], [bravo, second]] as const) { const ready = waitFor(socket, message => message.type === 'social-state'); socket.send(JSON.stringify({ type: 'auth', credentials })); await ready; }
    const invite = waitFor(bravo, message => message.type === 'social-state' && message.duels.some((duel: any) => duel.status === 'pending'));
    alpha.send(JSON.stringify({ type: 'duel-invite', target: second.id })); const pending = await invite;
    const ready = waitFor(alpha, message => message.type === 'duel-ready'); bravo.send(JSON.stringify({ type: 'duel-reply', duel: pending.duels[0].id, accept: true })); const match = await ready;
    const outsider = await open('/ws'); const rejected = waitFor(outsider, message => message.type === 'error'); outsider.send(JSON.stringify({ type: 'join', name: 'Stranger', code: match.code, account: stranger })); assert.match((await rejected).text, /RESERVED/);
    for (const [credentials, name] of [[first, 'First'], [second, 'Second']] as const) { const socket = await open('/ws'); const welcome = waitFor(socket, message => message.type === 'welcome'); socket.send(JSON.stringify({ type: 'join', name, code: match.code, create: false, account: credentials })); await welcome; }
    const room = game.rooms.get(match.code)!; assert.equal(room.mode, 'duel'); assert.equal(room.clients.size, 2); assert.equal(room.bots.length, 0); assert.equal(room.phase, 'buy'); assert.equal(room.bomb.carrier, null);
    assert.equal(new Set([...room.clients.values()].map(client => client.player.team)).size, 2);
  } finally { for (const socket of sockets) socket.close(); await game.close(); }
});