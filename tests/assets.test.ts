import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { allyBehindCover, configureAllyOutline, chooseClip, classifyWeaponMesh, normalizeModel, modelBounds, stripProjectileGeometry, CharacterMotion, ModelAnimation, ModelAssets, setTeamOutline, WEAPON_ASSETS, WEAPON_YAW } from '../client/assets.ts';
import { MAPS, SUPPLIED_MAP_IDS, createPlayer, getSites, simulateMovement, spawn, spawnPoints, wallHit, type Input } from '../shared/game.ts';
import { capsuleClear, registerMapGeometry, spawnGroup, walkLink } from '../shared/map-geometry.ts';
import { MeshBVH } from 'three-mesh-bvh';
import { botInput, createBrain, navigate, planBotRoute, visible } from '../shared/bots.ts';
import { emptyBomb, type RoundState } from '../shared/round.ts';
import { animateWeapon } from '../client/weapons.ts';
import { createMuzzleFlash, supplyCaseModel } from '../client/world.ts';

test('3D supply cases have finite body, lid, handle and latch geometry', () => {
  const model = supplyCaseModel('#61a59b'); const bounds = new THREE.Box3().setFromObject(model); const size = bounds.getSize(new THREE.Vector3());
  assert.ok(model.children.length >= 8); assert.ok(size.x > 1 && size.x < 1.5); assert.ok(size.y > 0.6 && size.z > 0.8);
  model.traverse(object => { if (object instanceof THREE.Mesh) { assert.ok([...object.geometry.getAttribute('position').array].every(Number.isFinite)); object.geometry.dispose(); for (const surface of [object.material].flat()) surface.dispose(); } });
});

test('original muzzle flashes use finite crossed planes and a transparent textured hot core', () => {
  const pistol = createMuzzleFlash('pistol'); const sniper = createMuzzleFlash('sniper');
  assert.equal(pistol.children.length, 2); assert.ok(sniper.scale.x > pistol.scale.x);
  const material = pistol.material; assert.equal(material.blending, THREE.AdditiveBlending); assert.equal(material.depthWrite, false);
  const texture = material.map as THREE.DataTexture; const image = texture.image; const data = image.data as Uint8Array;
  assert.equal(data[3], 0); assert.ok(data[(Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)) * 4 + 3] > 240);
  assert.ok(new THREE.Box3().setFromObject(pistol).getSize(new THREE.Vector3()).length() < 1);
  for (const flash of [pistol, sniper]) { flash.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); }); flash.material.dispose(); }
});

test('inventory previews do not preload unused first-person rigs or hands', () => {
  const library = new ModelAssets(); const loaded: string[] = []; library.load = async id => { loaded.push(id); return true; };
  assert.equal(library.weapon('autoShotgun', 'preview'), null); assert.deepEqual(loaded, ['field-shotgun']);
  loaded.length = 0; assert.equal(library.weapon('servicePistol', 'world'), null); assert.deepEqual(loaded, ['cz75']);
  loaded.length = 0; assert.equal(library.weapon('servicePistol', 'view'), null); assert.ok(loaded.includes('pistol-fps')); assert.ok(loaded.includes('deagle-view'));
});

test('animation selection prefers exact gameplay actions over unrelated weapon banks', () => {
  const clips = ['firstperson_reload_weapons/awp', 'firstperson_reload', 'firstperson_shoot1_additive', 'firstperson_shoot1', 'Inspect'].map(name => new THREE.AnimationClip(name, 2, []));
  assert.equal(chooseClip(clips, 'reload')?.name, 'firstperson_reload'); assert.equal(chooseClip(clips, 'fire')?.name, 'firstperson_shoot1'); assert.equal(chooseClip(clips, 'inspect')?.name, 'Inspect');
  const supplied = ['DRAW', 'IDLE', 'INSPEC', 'SHOOT', 'RELOAD1', 'MM_CS5_Inspect', 'Armature|Fire1'].map(name => new THREE.AnimationClip(name, 1, []));
  assert.equal(chooseClip(supplied, 'reload')?.name, 'RELOAD1'); assert.equal(chooseClip(supplied, 'inspect')?.name, 'INSPEC');
  assert.equal(chooseClip(supplied.filter(clip => clip.name.startsWith('MM_')), 'inspect')?.name, 'MM_CS5_Inspect');
  assert.equal(chooseClip(supplied, 'melee')?.name, 'Armature|Fire1');
  const fps = ['Rig|M4_Idle', 'Rig|M4_Fire_LastRoundCheck', 'Rig|M4_Fire', 'Rig|M4_ReloadOne_type1', 'Rig|M4_ReloadFull_type1', 'Armature|FPS_Pistol_Idle', 'Armature|FPS_Pistol_Reload_full'].map(name => new THREE.AnimationClip(name, 1, []));
  assert.equal(chooseClip(fps, 'fire')?.name, 'Rig|M4_Fire'); assert.equal(chooseClip(fps, 'reload')?.name, 'Rig|M4_ReloadFull_type1');
  assert.equal(chooseClip(fps.filter(clip => clip.name.includes('FPS_Pistol')), 'idle')?.name, 'Armature|FPS_Pistol_Idle');
});

test('spawn groups stay compact, clear and separated rather than spreading across a map', () => {
  const floor = new THREE.BoxGeometry(80, 1, 80).translate(0, -0.5, 0); const bvh = new MeshBVH(floor);
  const candidates = Array.from({ length: 61 }, (_, row) => Array.from({ length: 61 }, (_, column) => ({ x: column - 30, y: 0.003, z: row - 30 }))).flat();
  const group = spawnGroup(bvh, candidates, { x: -24, y: 0.003, z: -24 });
  assert.equal(group.length, 6);
  for (const point of group) {
    assert.ok(Math.hypot(point.x - group[0].x, point.z - group[0].z) <= 4.5);
    assert.ok(capsuleClear(bvh, point, 1.8, 0.65));
    for (const other of group) if (other !== point) assert.ok(Math.hypot(point.x - other.x, point.z - other.z) >= 1.5);
  }
  floor.dispose();
});

test('through-wall team outlines are subtle, ally-only and removable on team changes', () => {
  const model = new THREE.Group(); model.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
  setTeamOutline(model, 'CT', 'CT', false); assert.equal(model.userData.outlineSelected, false);
  setTeamOutline(model, 'CT', 'CT', true); assert.equal(model.userData.outlineColor, '#69afd7'); assert.equal(model.userData.outlineSelected, true);
  assert.equal(model.children.length, 1, 'outlines never add a filled duplicate mesh');
  setTeamOutline(model, 'CT', 'T', true); assert.equal(model.userData.outlineSelected, false);
  setTeamOutline(model, 'T', 'T', true); assert.equal(model.userData.outlineColor, '#d26e69');
  setTeamOutline(model, 'T', 'T', false); assert.equal(model.userData.outlineSelected, false);
  const pass = new OutlinePass(new THREE.Vector2(64, 64), new THREE.Scene(), new THREE.PerspectiveCamera());
  configureAllyOutline(pass, 'CT'); assert.equal(pass.visibleEdgeColor.getHex(), 0); assert.equal(pass.hiddenEdgeColor.getHexString(), '69afd7');
  assert.equal(pass.edgeGlow, 0); assert.equal(pass.usePatternTexture, false); assert.equal(pass.edgeThickness, 1); pass.dispose();
});

test('ally outlines require an opaque blocking wall and the DMR uses its native forward axis', () => {
  const viewer = createPlayer('viewer', 'Viewer', 'CT', 'elimination', 0); const ally = createPlayer('ally', 'Ally', 'CT', 'elimination', 1);
  Object.assign(viewer, { x: 0, y: 0, z: 0 }); Object.assign(ally, { x: 3, y: 0, z: 0 });
  assert.equal(allyBehindCover(viewer, ally, 'dustline'), false);
  Object.assign(ally, { x: -20, z: 0 }); assert.equal(allyBehindCover(viewer, ally, 'dustline'), true);
  ally.team = 'T'; assert.equal(allyBehindCover(viewer, ally, 'dustline'), false);
  assert.equal(WEAPON_YAW.g3sg1, 0);
});

test('weapon normalization handles incompatible native scales and excludes hidden backdrops', () => {
  const scene = new THREE.Group(); const gun = new THREE.Mesh(new THREE.BoxGeometry(2, 20, 1), new THREE.MeshStandardMaterial()); scene.add(gun);
  const background = new THREE.Mesh(new THREE.PlaneGeometry(200, 200)); background.visible = false; scene.add(background);
  const model = normalizeModel(scene, 'weapon', 0.92); const size = modelBounds(model).getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.z - 0.92) < 1e-6); assert.ok(size.y < 0.1);
});

test('weapon classification excludes demonstration rooms and identifies all supplied arm materials', () => {
  assert.equal(classifyWeaponMesh('cs5', 'Object_7', ['M_AmbientRoom001']).background, true);
  assert.equal(classifyWeaponMesh('scorpion', 'Object_19', ['Skybox']).background, true);
  assert.equal(classifyWeaponMesh('cs5', 'Copycs5_bodyunder001_M_McMillanCS5_UV1_0', ['M_McMillanCS5_UV1']).background, true);
  assert.equal(classifyWeaponMesh('cs5', 'Object_225', ['M_McMillanCS5_UV1']).background, true);
  for (const [id, material] of [['scorpion', 'Body'], ['scorpion', 'Cloths'], ['scorpion', 'Watch'], ['fennec', 'base_male_arm_skintone_01'], ['fennec', 'mp_western_lynch_kneepad_4_1'], ['cs5', 'arm_fps01_m01'], ['remington870', 'material'], ['precision-sniper', 'TEXTURA']]) assert.equal(classifyWeaponMesh(id, 'Object_10', [material]).hands, true, `${id}: ${material}`);
  for (const material of ['weapon_vm_sm_victor_body', 'weapon_rif_ak47', 'M_McMillanCS5_UV1', 'CZScorpion']) assert.deepEqual(classifyWeaponMesh('weapon', 'body_hd', [material]), { hands: false, background: false });
});

test('weapons without an idle clip retain a safe authored hold pose after firing', () => {
  const scene = new THREE.Group(); const hand = new THREE.Object3D(); hand.name = 'hand'; scene.add(hand);
  const clip = new THREE.AnimationClip('Shots', 1, [new THREE.VectorKeyframeTrack('hand.position', [0, 1], [0.1, 0.2, 0.3, 0.3, 0.5, 0.8])]);
  const animation = new ModelAnimation(scene, [clip]); animation.sample('fire', 0.7);
  animation.update(10, { reload: 0, inspect: -1, shotAge: 10, drawAge: 10 });
  assert.ok(hand.position.distanceTo(new THREE.Vector3(0.1, 0.2, 0.3)) < 1e-7); animation.dispose();
});

test('the original handcannon uses its complete authored equip spin and inspection', async () => {
  Object.defineProperty(globalThis, 'self', { configurable: true, value: globalThis });
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => ({ width: 1, height: 1, close() {} }) });
  try {
    const bytes = await readFile(new URL('../client/public/models/imported/handcannon-classic.glb', import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    const library = new ModelAssets(); Object.getOwnPropertyDescriptor(library, 'models')!.value.set('handcannon-classic', gltf);
    const weapon = library.weapon('handCannon', 'view')!; const animation = weapon.userData.animation as ModelAnimation;
    assert.equal(weapon.userData.assetId, 'handcannon-classic'); assert.equal(weapon.userData.hasHands, true); assert.equal(animation.has('draw'), true); assert.equal(animation.has('inspect'), true);
    assert.equal(weapon.userData.drawDuration, 2.75); assert.equal(library.weaponAsset('handCannon', 'world'), 'deagle');
    const rotations = () => { const values: number[] = []; weapon.traverse(object => { if (object instanceof THREE.Bone) values.push(...object.quaternion.toArray()); }); return values; };
    animation.update(1, { reload: 0, inspect: -1, shotAge: 10, drawAge: 0.3 }); const first = rotations();
    animation.update(2, { reload: 0, inspect: -1, shotAge: 10, drawAge: 1.2 }); assert.notDeepEqual(rotations(), first);
    animation.update(3, { reload: 0, inspect: -1, shotAge: 10, drawAge: 3 }); assert.ok(Number.isFinite(modelBounds(weapon, true).min.x));
    assert.ok(gltf.scene.getObjectsByProperty('isMesh', true).some(mesh => mesh instanceof THREE.Mesh && [mesh.material].flat().some(material => (material as THREE.MeshStandardMaterial).map)), 'classic textures survive material conversion'); animation.dispose();
  } finally { delete (globalThis as { self?: unknown }).self; delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap; }
});

test('authored knife strikes alternate source clips rather than repeating one slash', () => {
  const source = new THREE.Group(); const blade = new THREE.Object3D(); blade.name = 'blade'; source.add(blade);
  const clips = [new THREE.AnimationClip('Armature|Fire1', 1, [new THREE.NumberKeyframeTrack('blade.position[x]', [0, 1], [0, 1])]), new THREE.AnimationClip('Armature|Fire2', 1, [new THREE.NumberKeyframeTrack('blade.position[x]', [0, 1], [0, -1])])];
  const animation = new ModelAnimation(source, clips);
  animation.update(1, { reload: 0, inspect: -1, shotAge: 10, swingAge: 0.2, attack: 0 }); assert.ok(blade.position.x > 0);
  animation.update(2, { reload: 0, inspect: -1, shotAge: 10, swingAge: 0.2, attack: 1 }); assert.ok(blade.position.x < 0); animation.dispose();
});

test('dedicated shotgun fallback has usable authored firing and reload actions', async () => {
  const bytes = await readFile(new URL('../client/public/models/quaternius-shotgun.fbx', import.meta.url));
  const model = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  assert.ok(chooseClip(model.animations, 'fire')); assert.ok(chooseClip(model.animations, 'reload'));
  const normalized = normalizeModel(model, 'weapon', 0.92); const size = modelBounds(normalized).getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.z - 0.92) < 1e-5);
});

test('downloaded CC0 revolver retains authored fire and reload actions and finite weapon bounds', async () => {
  const bytes = await readFile(new URL('../client/public/models/quaternius-revolver.fbx', import.meta.url));
  const scene = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  stripProjectileGeometry(scene);
  const animation = new ModelAnimation(scene, scene.animations); assert.equal(animation.hold(), true);
  assert.ok(chooseClip(scene.animations, 'fire')); assert.ok(chooseClip(scene.animations, 'reload'));
  const model = normalizeModel(scene, 'weapon', 0.33); const size = modelBounds(model).getSize(new THREE.Vector3());
  assert.ok([...size].every(Number.isFinite)); assert.ok(Math.abs(size.z - 0.33) < 0.001); assert.ok(size.y > 0.08 && size.x > 0.01, 'detached projectiles cannot flatten the gun silhouette'); animation.dispose();
});

test('static imported weapons receive reversible reload and inspect motion', () => {
  const root = new THREE.Group(); const motion = new THREE.Group(); root.add(motion);
  root.userData.motion = motion; root.userData.animation = new ModelAnimation(new THREE.Group(), []);
  animateWeapon(root, { time: 1, reload: 0.5, inspect: -1, shotAge: 10, drawAge: 10 }); assert.ok(motion.position.y < -0.05);
  animateWeapon(root, { time: 2, reload: 0, inspect: 1, shotAge: 10, drawAge: 10 }); assert.ok(Math.abs(motion.rotation.y) > 0.1);
  animateWeapon(root, { time: 3, reload: 0, inspect: -1, shotAge: 10, drawAge: 10 }); assert.ok(motion.position.lengthSq() === 0); assert.ok(Math.abs(motion.rotation.y) < 1e-9);
  motion.userData.baseYaw = Math.PI;
  animateWeapon(root, { time: 4, reload: 0, inspect: -1, shotAge: 10, drawAge: 10 }); assert.equal(motion.rotation.y, Math.PI);
});

test('supplied GLBs retain textures, useful clips and independently animated SAS skeletons', async () => {
  Object.defineProperty(globalThis, 'self', { configurable: true, value: globalThis });
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => ({ width: 1, height: 1, close() {} }) });
  for (const id of ['ak47', 'm4a1s', 'sas']) {
    const bytes = await readFile(new URL(`../client/public/models/imported/${id}.glb`, import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    assert.ok(gltf.scene); assert.ok(gltf.animations.length > 0);
    const animation = new ModelAnimation(gltf.scene, gltf.animations); animation.sample(id === 'm4a1s' ? 'fire' : 'idle', 0);
    const model = normalizeModel(gltf.scene, id === 'sas' ? 'character' : 'weapon', id === 'sas' ? 1.78 : 0.92);
    if (id === 'sas') {
      model.userData.sourceScene = gltf.scene; model.userData.animation = animation;
      const operator = new THREE.Group(); operator.add(model); const motion = new CharacterMotion(model, operator);
      for (let frame = 0; frame < 60; frame++) motion.update(1 / 60, frame / 60, 4.8, false, false, 0.3, false);
      const bounds = modelBounds(model); assert.ok(Number.isFinite(bounds.min.x)); assert.ok(bounds.max.y - bounds.min.y > 1.2); assert.ok(bounds.max.y - bounds.min.y < 2.4, 'SAS rig stays human-sized');
      const sourceBones: number[] = []; gltf.scene.traverse(object => { if (object instanceof THREE.SkinnedMesh) sourceBones.push(object.skeleton.bones.length - object.skeleton.boneInverses.length); });
      assert.ok(sourceBones.every(difference => difference === 0), 'IK preserves skeleton inverse counts'); motion.dispose();
    } else assert.ok(chooseClip(gltf.animations, 'reload'));
    animation.dispose();
  }
  delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
  delete (globalThis as { self?: unknown }).self;
});

test('downloaded CC0 robot retains native locomotion and a correctly sized animated skeleton', async () => {
  const bytes = await readFile(new URL('../client/public/models/imported/robot.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  for (const action of ['idle', 'walk', 'run', 'death'] as const) assert.ok(chooseClip(gltf.animations, action), action);
  const model = normalizeModel(gltf.scene, 'character', 1.78); model.userData.sourceScene = gltf.scene; model.userData.animation = new ModelAnimation(gltf.scene, gltf.animations);
  const operator = new THREE.Group().add(model); const motion = new CharacterMotion(model, operator);
  for (let frame = 0; frame < 60; frame++) motion.update(1 / 60, frame / 60, 4.8, false, false, 0, false);
  const size = modelBounds(model).getSize(new THREE.Vector3()); assert.ok(size.y > 1.4 && size.y < 2.3); assert.ok([...size].every(Number.isFinite));
  for (let frame = 0; frame < 90; frame++) motion.update(1 / 60, 1 + frame / 60, 0, false, false, 0, true);
  assert.ok([...modelBounds(model).getSize(new THREE.Vector3())].every(Number.isFinite)); motion.dispose();
});

test('additional supplied firearms have distinct assets, finite bounds and usable authored actions', async () => {
  assert.equal(new Set(Object.values(WEAPON_ASSETS)).size, Object.keys(WEAPON_ASSETS).length);
  Object.defineProperty(globalThis, 'self', { configurable: true, value: globalThis });
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => ({ width: 1, height: 1, close() {} }) });
  try {
    for (const id of ['scar', 'fennec', 'scorpion', 'm16a2', 'remington870', 'cs5', 'precision-sniper', 'knife-animated', 'sas-red', 'benelli', 'pistol-fps']) {
      const bytes = await readFile(new URL(`../client/public/models/imported/${id}.glb`, import.meta.url));
      const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
      if (id !== 'sas-red') {
        const library = { models: new Map([[id, gltf]]) } as unknown as ModelAssets;
        const weapon = ModelAssets.prototype.instantiate.call(library, id, 'weapon', 0.92, 'world')!;
        const size = modelBounds(weapon, true).getSize(new THREE.Vector3());
        if (id !== 'knife-animated') assert.ok(size.z > size.x * 1.8, `${id}: a firearm silhouette, not a room or arm`);
        else assert.ok(size.z > 0.3 && size.x < 1 && size.y < 1, 'knife blade remains finite and weapon-sized');
        weapon.traverse(object => { if (object.userData.hands) assert.equal(object.visible, false, `${id}: world model has no attached arms`); });
        const view = ModelAssets.prototype.instantiate.call(library, id, 'weapon', 0.92, 'view')!;
        if (id === 'benelli' || id === 'pistol-fps') { assert.equal(view.userData.hasHands, true, `${id}: retains authored hands`); assert.ok(!gltf.parser.json.extensionsUsed?.includes('KHR_materials_pbrSpecularGlossiness'), `${id}: supported textured materials`); for (const action of ['idle', 'fire', 'reload'] as const) assert.ok(chooseClip(gltf.animations, action), `${id}: ${action} clip`); }
        view.traverse(object => { if (object instanceof THREE.Mesh && object.userData.hands && object.visible) { const bounds = modelBounds(object); const size = bounds.getSize(new THREE.Vector3()); assert.ok(Math.max(size.x, size.y, size.z) < 3, `${id}: visible hands stay human-sized`); } });
        if (['m16a2', 'remington870', 'precision-sniper'].includes(id)) assert.equal(weapon.userData.motion.rotation.y, 0, `${id}: native forward orientation`);
      }
      const animation = new ModelAnimation(gltf.scene, gltf.animations); animation.sample('idle', 0);
      const model = normalizeModel(gltf.scene, id === 'sas-red' ? 'character' : 'weapon', id === 'sas-red' ? 1.78 : 0.92);
      const bounds = modelBounds(model); assert.ok(Number.isFinite(bounds.min.x), id); assert.ok(bounds.max.x - bounds.min.x < 5, id);
      if (['scar', 'fennec', 'scorpion', 'cs5'].includes(id)) assert.ok(chooseClip(gltf.animations, 'reload'), `${id} authored reload`);
      if (id === 'knife-animated') assert.ok(chooseClip(gltf.animations, 'melee'));
      animation.dispose();
    }
  } finally { delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap; delete (globalThis as { self?: unknown }).self; }
});

test('SAS first-person arm extraction preserves finite packed vertex and skin attributes', async () => {
  Object.defineProperty(globalThis, 'self', { configurable: true, value: globalThis });
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => ({ width: 1, height: 1, close() {} }) });
  let arms: THREE.Group | null = null;
  try {
    const bytes = await readFile(new URL('../client/public/models/imported/sas.glb', import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    const source = clone(gltf.scene); const asset = normalizeModel(source, 'character', 1.78);
    asset.userData.sourceScene = source; asset.userData.animation = new ModelAnimation(source, gltf.animations);
    arms = ModelAssets.prototype.viewArms.call({ instantiate: (id: string) => id === 'sas' ? asset : null, pistolArms: () => null } as unknown as ModelAssets);
    assert.ok(arms);
    let triangles = 0;
    arms.traverse(object => {
      if (!(object instanceof THREE.SkinnedMesh)) return;
      const position = object.geometry.getAttribute('position');
      const skin = object.geometry.getAttribute('skinIndex'); const weights = object.geometry.getAttribute('skinWeight');
      assert.equal(position.count, skin.count); assert.equal(position.count, weights.count);
      for (let vertex = 0; vertex < position.count; vertex++) for (let component = 0; component < 3; component++) assert.ok(Number.isFinite(position.getComponent(vertex, component)), `finite position ${object.name}:${vertex}:${component}`);
      for (const index of object.geometry.index!.array) assert.ok(index >= 0 && index < position.count, `${object.name} valid arm index`);
      triangles += object.geometry.index!.count / 3;
    });
    assert.ok(triangles > 100);
  } finally {
    (arms?.userData.characterMotion as CharacterMotion | undefined)?.dispose();
    delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap; delete (globalThis as { self?: unknown }).self;
  }
});

test('fallback hands select pistol-authored grips for sidearms instead of rifle support hands', () => {
  for (const [weapon, expected] of [['pistol', 'deagle-view'], ['rifle', 'm4a1s'], ['knife', 'knife-flip']] as const) {
    const requested: string[] = []; const native = new THREE.Group(); native.userData.hasHands = true;
    const arms = ModelAssets.prototype.viewArms.call({ instantiate: (id: string) => { requested.push(id); return native; }, pistolArms: () => null } as unknown as ModelAssets, weapon);
    assert.equal(requested[0], expected); assert.equal(arms?.userData.weaponGrip, weapon); assert.equal(arms?.userData.nativeArms, true);
  }
});

test('Zone 7 starts use the standing floor below buildings rather than their roofs', async () => {
  const bytes = await readFile(new URL('../client/public/models/imported/zona7.collision.bin', import.meta.url));
  const geometry = registerMapGeometry('zona7', bytes);
  for (const point of [...geometry.metadata.spawns.CT, ...geometry.metadata.spawns.T]) {
    const ray = new THREE.Ray(new THREE.Vector3(point.x, geometry.metadata.bounds[4] + 2, point.z), new THREE.Vector3(0, -1, 0));
    const floors = geometry.bvh.raycast(ray, THREE.DoubleSide).filter(hit => Math.abs(hit.face!.normal.y) > 0.55).map(hit => ({ x: point.x, y: hit.point.y + 0.003, z: point.z })).filter(floor => capsuleClear(geometry.bvh, floor, 1.8, 0.4)).sort((first, second) => first.y - second.y);
    assert.ok(floors.length, 'a standing floor is available');
    assert.ok(Math.abs(point.y - floors[0].y) < 0.05, `spawn ${point.x},${point.z} is on the ground floor, not height ${point.y}`);
    assert.ok(geometry.bvh.raycastFirst(new THREE.Ray(new THREE.Vector3(point.x, point.y + 1.85, point.z), new THREE.Vector3(0, 1, 0)), THREE.DoubleSide, 0, 8), 'start is below a building ceiling');
  }
});

test('Dune bots choose varied physically traversable routes to a common opponent', async () => {
  const bytes = await readFile(new URL('../client/public/models/imported/dune.collision.bin', import.meta.url));
  const geometry = registerMapGeometry('dune', bytes);
  const from = geometry.metadata.spawns.CT[0]; const to = geometry.metadata.spawns.T[0];
  const routes = Array.from({ length: 5 }, (_, index) => navigate('dune', from, to, index + 1));
  assert.ok(new Set(routes.map(route => JSON.stringify(route))).size >= 4, 'teammates do not all follow one path');
  for (const route of routes) {
    assert.ok(route.length > 2);
    let previous = from;
    for (const point of route) { assert.ok(walkLink(geometry.bvh, previous, point)); previous = point; }
    assert.ok(Math.hypot(previous.x - to.x, previous.z - to.z) < 1);
  }
});

test('five teammates reserve distinct routes instead of independently selecting the same corridor', async () => {
  const geometry = registerMapGeometry('dune', await readFile(new URL('../client/public/models/imported/dune.collision.bin', import.meta.url)));
  const from = geometry.metadata.spawns.CT[0]; const goal = geometry.metadata.spawns.T[0];
  const players = Array.from({ length: 5 }, (_, index) => Object.assign(createPlayer(`squad-${index}`, 'Bot', 'CT', 'elimination', index), from));
  const state: RoundState = { mode: 'elimination', map: 'dune', phase: 'live', endsAt: 200000, score: { CT: 0, T: 0 }, bomb: emptyBomb(), round: 1, events: [] };
  const brains = players.map((_, index) => createBrain(index, () => 0.4));
  const paths = players.map((player, index) => planBotRoute(player, players, state, brains[index], goal));
  assert.equal(new Set(brains.map(brain => brain.routeId % 9)).size, 5, 'each living teammate receives a unique lane');
  assert.equal(new Set(paths.map(path => JSON.stringify(path))).size, 5, 'complete squad routes differ even from the same start and goal');
  for (const path of paths) { assert.ok(path.length > 2); let previous = from; for (const point of path) { assert.ok(walkLink(geometry.bvh, previous, point)); previous = point; } }
  const lane = brains[0].routeId % 9; state.round++; planBotRoute(players[0], players, state, brains[0], goal); assert.notEqual(brains[0].routeId % 9, lane, 'rounds rotate corridor preferences');
});

test('full squads move through Dune and Breeze without sustained teammate overlap', async () => {
  for (const map of ['dune', 'breeze'] as const) {
    registerMapGeometry(map, await readFile(new URL(`../client/public/models/imported/${map}.collision.bin`, import.meta.url)));
    const players = Array.from({ length: 10 }, (_, index) => createPlayer(`bot-squad-${index}`, 'Bot', index < 5 ? 'CT' : 'T', 'elimination', index));
    players.forEach((player, index) => spawn(player, index, map, players));
    const brains = players.map((_, index) => createBrain(index, () => 0.2718));
    const state: RoundState = { mode: 'elimination', map, phase: 'live', endsAt: 200000, score: { CT: 0, T: 0 }, bomb: emptyBomb(), round: 1, events: [] };
    const overlap = new Map<string, number>(); let longest = 0;
    for (let tick = 0; tick < 64 * 20; tick++) {
      players.forEach((player, index) => simulateMovement(player, botInput(player, players, state, brains[index], 100000 + tick * 1000 / 64), false, map));
      for (let first = 0; first < players.length; first++) for (let second = first + 1; second < players.length; second++) {
        if (players[first].team !== players[second].team) continue;
        const key = `${first}:${second}`; const close = Math.hypot(players[first].x - players[second].x, players[first].z - players[second].z) < 0.65;
        const consecutive = close ? (overlap.get(key) || 0) + 1 : 0; overlap.set(key, consecutive); longest = Math.max(longest, consecutive);
      }
    }
    assert.ok(longest < 16, `${map}: teammates must not remain stacked for a quarter second`);
  }
});

test('Dune starts are within buildings and Breeze teams occupy different architectural regions', async () => {
  for (const id of ['dune', 'breeze'] as const) {
    const geometry = registerMapGeometry(id, await readFile(new URL(`../client/public/models/imported/${id}.collision.bin`, import.meta.url)));
    for (const point of [...geometry.metadata.spawns.CT, ...geometry.metadata.spawns.T]) {
      let walls = 0;
      for (let direction = 0; direction < 12; direction++) { const angle = direction / 12 * Math.PI * 2; const hit = geometry.bvh.raycastFirst(new THREE.Ray(new THREE.Vector3(point.x, point.y + 1.1, point.z), new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle))), THREE.DoubleSide, 0, 35); if (hit && Math.abs(hit.face!.normal.y) < 0.65) walls++; }
      assert.ok(walls >= 9, `${id}: spawn is in architecture, not the outer plain`);
    }
    if (id === 'breeze') for (const first of geometry.metadata.spawns.CT) for (const second of geometry.metadata.spawns.T) assert.ok(Math.hypot(first.x - second.x, first.z - second.z) > 75);
  }
});

test('bots physically follow supplied-map routes until an opposing start becomes visible', async () => {
  for (const map of SUPPLIED_MAP_IDS) {
    registerMapGeometry(map, await readFile(new URL(`../client/public/models/imported/${map}.collision.bin`, import.meta.url)));
    const bot = createPlayer(`walker-${map}`, 'Walker', 'CT', 'elimination', 0); const enemy = createPlayer(`opponent-${map}`, 'Opponent', 'T', 'elimination', 1);
    spawn(bot, 0, map); spawn(enemy, 0, map);
    const brain = createBrain(0); const players = [bot, enemy];
    const state: RoundState = { mode: 'elimination', map, phase: 'live', endsAt: 200000, score: { CT: 0, T: 0 }, bomb: emptyBomb(), round: 1, events: [] };
    let acquired = visible(bot, enemy, map);
    for (let tick = 0; tick < 64 * 75 && !acquired; tick++) {
      simulateMovement(bot, botInput(bot, players, state, brain, 100000 + tick * 1000 / 64), false, map);
      acquired = visible(bot, enemy, map);
    }
    assert.ok(acquired, `${map}: bot could not find the opposing team from ${bot.x.toFixed(1)},${bot.y.toFixed(1)},${bot.z.toFixed(1)}`);
  }
});

test('every supplied level has exact floor collision, height-correct spawns and bot routes between teams', async () => {
  for (const map of Object.values(MAPS).filter(map => map.imported)) {
    const bytes = await readFile(new URL(`../client/public/models/imported/${map.id}.collision.bin`, import.meta.url));
    const geometry = registerMapGeometry(map.id, bytes);
    assert.ok(geometry.metadata.navigation.length >= 100, map.id);
    const players = Array.from({ length: 10 }, (_, index) => createPlayer(`map-${index}`, 'Player', index % 2 ? 'T' : 'CT', 'deathmatch', index));
    for (const [index, player] of players.entries()) {
      spawn(player, index, map.id, players);
      assert.ok(capsuleClear(geometry.bvh, player, 1.8, 0.29), `${map.id} spawn clearance`);
      assert.ok(players.every(other => other === player || Math.hypot(player.x - other.x, player.z - other.z) > 1.2), `${map.id} spawn spacing`);
      const floor = wallHit(new THREE.Ray(new THREE.Vector3(player.x, player.y + 1.5, player.z), new THREE.Vector3(0, -1, 0)), 3, map.id);
      assert.ok(Math.abs(floor - 1.503) < 0.03, `${map.id} floor ray ${floor}`);
      const input: Input = { seq: 1, time: 0, forward: 0, side: 0, yaw: player.yaw, pitch: 0, jump: false, crouch: false, sprint: false, fire: false, reload: false, scope: false, interact: false, weapon: player.weapon };
      const height = player.y; for (let tick = 0; tick < 90; tick++) simulateMovement(player, input, false, map.id);
      assert.ok(Math.abs(player.y - height) < 0.04, `${map.id} stable capsule floor`);
      assert.equal(player.grounded, true, `${map.id} grounded`);
    }
    const from = spawnPoints('CT', map.id)[0]; const to = spawnPoints('T', map.id)[0];
    for (const ct of spawnPoints('CT', map.id)) for (const terrorist of spawnPoints('T', map.id)) assert.ok(Math.hypot(ct.x - terrorist.x, ct.z - terrorist.z) > 40, `${map.id} separated team starts`);
    const route = navigate(map.id, from, to);
    assert.ok(route.length > 2, `${map.id} connected team route`);
    let previous = from;
    for (const waypoint of route) { assert.ok(walkLink(geometry.bvh, previous, waypoint), `${map.id} physically traversable route`); previous = waypoint; }
    const sites = getSites(map.id);
    assert.ok(Math.hypot(sites[0].x - sites[1].x, sites[0].z - sites[1].z) >= 36, `${map.id} bomb sites are distinct areas`);
    for (const site of getSites(map.id)) assert.ok(navigate(map.id, from, site).length > 0, `${map.id} reachable site ${site.name}`);
  }
});