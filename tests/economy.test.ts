import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CASES, KEY_PRICE, SKIN_CATALOG, SKIN_BY_ID, DEFAULT_KNIFE_ID, KNIFE_KINDS, creditReward, createProfile, seededRandom, wearName, itemValue, rollCase, openCase, caseOdds, caseOpeningCost, validAppearance } from '../shared/economy.ts';
import { WEAPONS } from '../shared/game.ts';
import { buildWeapon, charmPendant, animateWeapon, applyFieldFinish, disposeWeapon, inspectPose, knifeHoldPose, meleePose, wearMarks } from '../client/weapons.ts';
import { attachCharm, CHARMS, CHARM_BY_ID, CHARM_CASES, openCharmCase, charmCaseOdds, rareReveal, rollCharmCase } from '../shared/economy.ts';
import { Armory, loadProfile } from '../client/armory.ts';
import { parseCrosshair } from '../client/settings.ts';
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';

test('every weapon and each knife kind has more than 500 stable, distinct finishes', () => {
  for (const weapon of Object.keys(WEAPONS)) {
    const finishes = SKIN_CATALOG.filter(skin => skin.weapon === weapon);
    assert.ok(finishes.length > 500, weapon);
    assert.equal(new Set(finishes.map(skin => `${skin.name}:${skin.seed}:${skin.colors.join()}`)).size, finishes.length);
  }
  assert.equal(new Set(SKIN_CATALOG.map(skin => skin.id)).size, SKIN_CATALOG.length);
  for (const knife of KNIFE_KINDS) assert.ok(SKIN_CATALOG.filter(skin => skin.knife === knife).length > 500);
  assert.equal(SKIN_BY_ID.get('rifle-9')?.name, 'Prism Fade');
  assert.equal(SKIN_BY_ID.get('knife-karambit-2')?.name, 'Tiger Tooth');
  const profile = createProfile();
  assert.equal(profile.items.find(item => item.uid === profile.equipped.knife)?.skinId, DEFAULT_KNIFE_ID);
  assert.equal(itemValue(profile.items.find(item => item.skinId === DEFAULT_KNIFE_ID)!), 0);
  assert.ok(!profile.items.some(item => item.skinId === 'knife-archive'));
  for (const weapon of Object.keys(WEAPONS)) for (const pattern of ['circuit', 'glyph', 'topographic', 'shards', 'chromatic', 'aurora', 'ceramic']) assert.ok(SKIN_CATALOG.some(skin => skin.weapon === weapon && skin.pattern === pattern), `${weapon}: ${pattern}`);
});

test('seeded drops are reproducible and wear/value reflect float and StatTrak', () => {
  const first = rollCase('dust', seededRandom(59)); const second = rollCase('dust', seededRandom(59));
  assert.equal(first.skinId, second.skinId); assert.equal(first.seed, second.seed); assert.equal(first.float, second.float);
  assert.equal(wearName(0.069), 'Factory New'); assert.equal(wearName(0.07), 'Minimal Wear');
  assert.equal(wearName(0.15), 'Field-Tested'); assert.equal(wearName(0.38), 'Well-Worn'); assert.equal(wearName(0.45), 'Battle-Scarred');
  assert.ok(itemValue({ ...first, float: 0 }) > itemValue({ ...first, float: 1 }));
  assert.ok(itemValue({ ...first, statTrak: true }) > itemValue({ ...first, statTrak: false }));
  assert.ok(validAppearance(first)); assert.ok(SKIN_BY_ID.has(first.skinId));
});

test('cases consume exactly one case and key and publish normalized rarity odds', () => {
  const profile = createProfile(); const count = profile.items.length;
  assert.ok(openCase(profile, 'dust', seededRandom(123)));
  assert.equal(profile.items.length, count + 1); assert.equal(profile.keys, 0); assert.equal(profile.cases.dust, 0);
  assert.equal(openCase(profile, 'dust'), null);
  for (const crate of CASES) assert.ok(Math.abs(caseOdds(crate.id).reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  assert.ok(caseOdds('blade')[6] > caseOdds('dust')[6]);
});

test('rare vault presentation gates high-tier rewards without rerolling or charging again', () => {
  assert.equal(rareReveal(3), false); for (const tier of [4, 5, 6]) assert.equal(rareReveal(tier), true);
  const profile = createProfile(); const count = profile.items.length;
  const item = openCase(profile, 'dust', () => 0.9999)!; const saved = structuredClone(profile);
  assert.ok(rareReveal(SKIN_BY_ID.get(item.skinId)!.rarity));
  for (let reveal = 0; reveal < 3; reveal++) assert.ok(rareReveal(SKIN_BY_ID.get(item.skinId)!.rarity));
  assert.deepEqual(profile, saved); assert.equal(profile.items.length, count + 1);
  for (const crate of CHARM_CASES) {
    const odds = charmCaseOdds(crate.id); assert.ok(Math.abs(odds.reduce((sum, chance) => sum + chance, 0) - 1) < 1e-12);
    const preview = rollCharmCase(crate.id, [], seededRandom(8)); assert.ok(preview && crate.charms.includes(preview));
    assert.equal(rollCharmCase(crate.id, crate.charms), null); assert.ok(charmCaseOdds(crate.id, crate.charms).every(chance => chance === 0));
  }
});

test('AK has grouped recognizable parts and magazine/bolt animation', () => {
  const gun = buildWeapon('rifle');
  for (const name of ['receiver', 'wood-stock', 'curved-magazine', 'barrel', 'gas-tube', 'front-sight-ring', 'trigger', 'bolt']) assert.ok(gun.getObjectByName(name), name);
  const magazine = gun.getObjectByName('magazine')!;
  animateWeapon(gun, { time: 1, reload: 0.3, inspect: -1, shotAge: 10 });
  assert.ok(magazine.position.y < -0.3);
  animateWeapon(gun, { time: 2, reload: 0, inspect: -1, shotAge: 10 });
  assert.equal(magazine.position.y, 0);
  disposeWeapon(gun);
});

test('every crate can be unlocked with a universal key and purchases are atomic', () => {
  assert.ok(CASES.length >= 9);
  for (const crate of CASES) {
    const profile = createProfile(); profile.cases[crate.id] = 0; profile.keys = 1;
    const count = profile.items.length; const credits = profile.credits;
    assert.equal(caseOpeningCost(profile, crate.id), crate.price);
    assert.ok(openCase(profile, crate.id, seededRandom(551), true));
    assert.equal(profile.keys, 0); assert.equal(profile.cases[crate.id], 0); assert.equal(profile.items.length, count + 1); assert.equal(profile.credits, credits - crate.price);
    assert.equal(caseOpeningCost(profile, crate.id), crate.price + KEY_PRICE);
    profile.credits = 0; const before = structuredClone(profile);
    assert.equal(openCase(profile, crate.id, seededRandom(1), true), null); assert.deepEqual(profile, before);
    for (let seed = 0; seed < 30; seed++) {
      const drop = SKIN_BY_ID.get(rollCase(crate.id, seededRandom(seed)).skinId)!;
      assert.ok(drop.knife ? crate.knives.includes(drop.knife) : !crate.weapons.length || crate.weapons.includes(drop.weapon));
    }
  }
});

test('invalid saved inventory recovers and crosshair settings are bounded', () => {
  const profile = loadProfile({ getItem: () => '{invalid' });
  assert.equal(profile.items.length, 21);
  const crosshair = parseCrosshair({ gap: -50, thickness: 400, length: NaN, color: 'url(evil)', style: 'dynamic' });
  assert.equal(crosshair.gap, 0); assert.equal(crosshair.thickness, 6); assert.equal(crosshair.length, 7);
  assert.equal(crosshair.color, '#a9e6bb'); assert.equal(crosshair.style, 'dynamic');
});

test('cloud synchronization removes transferred items without deleting local inventory', () => {
  const profile = createProfile(); const original = profile.items.map(item => item.uid); const values = new Map<string, string>();
  const armory = { profile, storage: { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value) }, isOpen: false, save() {}, onEquip() {} } as unknown as Armory;
  const cloud = { ...profile.items[0], uid: 'server-owned-item' };
  Armory.prototype.mergeCloudItems.call(armory, [cloud], 'cloud-profile'); assert.equal(profile.items.length, original.length + 1);
  profile.equipped.rifle = cloud.uid;
  Armory.prototype.mergeCloudItems.call(armory, [cloud], 'cloud-profile'); assert.equal(profile.items.length, original.length + 1);
  Armory.prototype.mergeCloudItems.call(armory, [], 'cloud-profile'); assert.deepEqual(profile.items.map(item => item.uid), original);
  assert.notEqual(profile.equipped.rifle, cloud.uid);
});

test('butterfly inspect animates both independent handles and resets', () => {
  const knife = buildWeapon('knife', undefined, 1);
  animateWeapon(knife, { time: 1, reload: 0, inspect: 1, shotAge: 10 });
  assert.ok(Math.abs(knife.getObjectByName('butterfly-left')!.rotation.x) > 0.1);
  animateWeapon(knife, { time: 5, reload: 0, inspect: -1, shotAge: 10 });
  assert.equal(knife.getObjectByName('butterfly-left')!.rotation.x, 0);
  disposeWeapon(knife);
});

test('knife slash winds up, sweeps forward and returns smoothly without firearm recoil', () => {
  const rest = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
  assert.deepEqual(meleePose(-1), rest); assert.deepEqual(meleePose(0.45), rest);
  assert.ok(meleePose(0.08).yaw > 0);
  assert.ok(meleePose(0.24).x < -0.1); assert.ok(meleePose(0.24).z < 0); assert.ok(meleePose(0.24).roll > 0.25);
  for (let age = 0; age < 0.45; age += 0.01) { assert.ok(Math.abs(meleePose(age).yaw) < 0.55); assert.ok(Math.abs(meleePose(age).roll) < 0.8); }
  assert.ok(Math.abs(meleePose(0.449).roll) < 0.001);
  assert.ok(meleePose(0.24, 2).z < meleePose(0.24, 0).z); assert.ok(Math.abs(meleePose(0.24, 2).roll) < 0.2);
});

test('knife hold and inspection use a one-handed diagonal grip and return exactly to rest', () => {
  const rest = knifeHoldPose(-1, 10); assert.ok(rest.roll > 0.55 && rest.roll < 0.8); assert.ok(rest.pitch > 0.2 && rest.pitch < 0.4);
  const inspected = knifeHoldPose(1.5, 10); assert.ok(inspected.x < rest.x); assert.ok(inspected.y > rest.y); assert.ok(inspected.roll < rest.roll);
  assert.deepEqual(knifeHoldPose(4, 10), rest); assert.ok(knifeHoldPose(-1, 0.24, 2).z < rest.z - 0.2);
  const knife = buildWeapon('knife'); const size = new Box3().setFromObject(knife).getSize(new Vector3()); assert.ok(Math.max(size.x, size.y, size.z) < 0.4, 'field knife is not an oversized viewmodel'); disposeWeapon(knife);
});

test('every weapon has a distinct reversible inspect pose and knife finger spins', () => {
  const ids = Object.keys(WEAPONS) as (keyof typeof WEAPONS)[];
  assert.equal(new Set(ids.map(id => JSON.stringify(inspectPose(id, 1.3)))).size, ids.length);
  for (const id of ids) assert.deepEqual(inspectPose(id, 4), inspectPose(id, -1));
  assert.ok(inspectPose('knife', 1.2).spin >= Math.PI * 1.99);
  assert.ok(Math.abs(inspectPose('knife', 2.7).spin) < 0.001, 'the reverse spin catches back at the original grip');
  assert.equal(meleePose(0.24, 1).roll, -meleePose(0.24, 0).roll);
  const karambit = buildWeapon('knife'); animateWeapon(karambit, { time: 1.2, reload: 0, inspect: 1.2, shotAge: 10 });
  assert.ok(karambit.getObjectByName('knife-pivot')!.rotation.y > Math.PI * 1.99, 'spin uses the finger ring axis');
  animateWeapon(karambit, { time: 4, reload: 0, inspect: -1, shotAge: 10 }); assert.equal(karambit.getObjectByName('knife-pivot')!.rotation.y, 0); disposeWeapon(karambit);
});

test('field issue finishes suppress silvery source materials without tinting hands', () => {
  const root = new Group(); const gun = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ color: '#ffffff', metalness: 1, roughness: 0.1 }));
  const hands = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ color: '#ffffff' })); hands.userData.hands = true; root.add(gun, hands);
  applyFieldFinish(root, 'rifle');
  assert.ok(gun.material.color.getHex() !== 0xffffff); assert.ok(gun.material.roughness >= 0.7); assert.ok(gun.material.metalness <= 0.32);
  assert.equal(hands.material.color.getHex(), 0xffffff); disposeWeapon(root);
});

test('cosmetic rewards favor solo elimination and online play over training', () => {
  assert.equal(creditReward('training', true, { type: 'kill' }), 5);
  assert.equal(creditReward('training', true, { type: 'round', team: 'CT' }, 'CT'), 0);
  assert.equal(creditReward('elimination', true, { type: 'kill' }), 250);
  assert.equal(creditReward('deathmatch', false, { type: 'kill' }), 250);
  assert.equal(creditReward('defusal', true, { type: 'kill' }), 0);
  assert.equal(creditReward('defusal', false, { type: 'bomb', text: 'Bomb planted' }), 350);
});

test('weapon wear scratches are reproducible, increase with wear and vanish on pristine items', () => {
  assert.equal(wearMarks(5, 0).length, 0);
  assert.deepEqual(wearMarks(5, 0.8), wearMarks(5, 0.8));
  assert.ok(wearMarks(5, 0.8).length > wearMarks(5, 0.1).length * 20);
  assert.notDeepEqual(wearMarks(5, 0.8), wearMarks(6, 0.8));
});

test('owned charms attach, animate and detach without changing weapon ownership', () => {
  const profile = createProfile(); const item = profile.items[0];
  assert.equal(attachCharm(profile, item.uid, 'signal-gem'), false); assert.equal(openCharmCase(profile, 'signal-charms', () => 0), 'signal-gem');
  assert.equal(attachCharm(profile, item.uid, 'signal-gem'), true); assert.equal(validAppearance(item), true);
  assert.equal(attachCharm(profile, 'forged-item', 'signal-gem'), false); assert.equal(attachCharm(profile, item.uid, 'invalid'), false);
  const weapon = buildWeapon('rifle', item); const charm = weapon.getObjectByName('weapon-charm'); assert.ok(charm);
  animateWeapon(weapon, { time: 1, reload: 0, inspect: -1, shotAge: 0.1 }); assert.ok(Math.abs(charm.rotation.z) > 0.01);
  assert.equal(attachCharm(profile, item.uid, ''), true); assert.equal(item.charm, undefined); disposeWeapon(weapon);
});

test('charm cases only unlock charms, never guns, and completed or unaffordable opens are atomic', () => {
  const profile = createProfile(); profile.credits = 1000000; const count = profile.items.length; const keys = profile.keys;
  for (const crate of CHARM_CASES) for (let index = 0; index < crate.charms.length; index++) assert.ok(openCharmCase(profile, crate.id, () => 0));
  assert.equal(profile.items.length, count); assert.equal(profile.keys, keys); assert.equal(new Set(profile.unlockedCharms).size, CHARMS.length);
  const before = structuredClone(profile); assert.equal(openCharmCase(profile, 'field-charms'), null); assert.deepEqual(profile, before);
  const poor = createProfile(); poor.credits = 0; const empty = structuredClone(poor); assert.equal(openCharmCase(poor, 'signal-charms'), null); assert.deepEqual(poor, empty);
});

test('over three hundred collectible charms have unique identities, varied forms and exclusive crate coverage', () => {
  assert.equal(CHARMS.length, 325); assert.equal(CHARM_BY_ID.size, CHARMS.length); assert.equal(new Set(CHARMS.map(charm => charm.name)).size, CHARMS.length);
  assert.ok(new Set(CHARMS.map(charm => charm.shape)).size >= 20);
  const covered = CHARM_CASES.flatMap(crate => crate.charms); assert.equal(covered.length, CHARMS.length); assert.equal(new Set(covered).size, CHARMS.length);
  assert.ok(covered.every(id => CHARM_BY_ID.has(id))); assert.ok(CHARM_CASES.every(crate => crate.charms.length > 0));
});

test('every charm form builds finite pendant geometry with distinctive silhouettes', () => {
  const signatures = new Set<string>(); const forms = [...new Set(CHARMS.map(charm => charm.shape))];
  for (const shape of forms) {
    const model = charmPendant(CHARMS.find(charm => charm.shape === shape)!); const size = new Box3().setFromObject(model).getSize(new Vector3());
    assert.ok([...size].every(Number.isFinite), shape); assert.ok(Math.max(...size) < 0.12 && Math.max(...size) > 0.01, shape);
    let triangles = 0; model.traverse(object => { if (object instanceof Mesh) triangles += (object.geometry.index?.count || object.geometry.getAttribute('position').count) / 3; });
    signatures.add(`${triangles}:${size.toArray().map(value => value.toFixed(4)).join(':')}`); disposeWeapon(model);
  }
  assert.ok(signatures.size >= 18);
});

test('detailed weapons batch static parts without flattening animated joints', () => {
  for (const id of ['rifle', 'carbine', 'sniper', 'compactSmg', 'pistol', 'knife'] as const) {
    const model = buildWeapon(id); let draws = 0;
    model.traverse(part => { if (part instanceof Mesh) draws++; });
    assert.ok(draws <= 18, `${id}: ${draws} draw calls`);
    if (id !== 'knife') assert.ok(model.getObjectByName('magazine'));
    disposeWeapon(model);
  }
});