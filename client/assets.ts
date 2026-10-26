import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { CCDIKSolver } from 'three/addons/animation/CCDIKSolver.js';
import type { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { WEAPONS, eyeHeight, wallHit, type MapId, type Player, type Team, type WeaponId } from '../shared/game.ts';

export type AssetEntry = { url: string; kind: string; bytes: number; clips: string[]; license: string | null; attribution: string };
export type AnimationKind = 'idle' | 'draw' | 'fire' | 'reload' | 'inspect' | 'melee' | 'walk' | 'run' | 'crouch' | 'death';
export type ActionRanges = Partial<Record<AnimationKind, readonly [number, number]>>;
export const MODEL_ACTION_RANGES: Record<string, ActionRanges> = { 'handcannon-classic': { idle: [0, 0], draw: [0, 2.75], inspect: [0, 2.75] } };
export const WEAPON_ASSETS: Record<WeaponId, string> = {
  rifle: 'ak47', pistol: 'usp', sniper: 'awp', carbine: 'm4a4', battleRifle: 'scar', burstRifle: 'm16a2', bullpup: 'aug',
  smg: 'mp5', vector: 'fennec', machinePistol: 'scorpion', shotgun: 'remington870', autoShotgun: 'field-shotgun', marksman: 'g3sg1', scout: 'cs5',
  heavySniper: 'precision-sniper', revolver: 'field-revolver', servicePistol: 'cz75', compactSmg: 'bizon', lmg: 'negev', handCannon: 'deagle', knife: 'karambit',
};
export const WEAPON_YAW: Record<string, number> = { 'field-shotgun': 0, 'field-revolver': 0, m16a2: 0, remington870: 0, 'precision-sniper': 0, g3sg1: 0 };
const patterns: Record<AnimationKind, RegExp> = {
  idle: /^(firstperson_idle|idle|idle_rifle)$/i, draw: /^(firstperson_draw|equip|equip_start|take|draw|draw_first)$/i,
  fire: /^(firstperson_shoot1|shots|shoot|fire|fire1|firewbullet|firewobullet)$/i, reload: /^(firstperson_reload|reload|reload1|reload_empty)$/i,
  inspect: /^(firstperson_lookat01|inspect|inspec|lookat)$/i, melee: /^(firstperson_(slash[12]?|stab|attack)|slash[12]?|stab|attack|fire[12]|melee_hit_0[123])$/i,
  walk: /^(walk|walking|walk_rifle)$/i, run: /^(run|running|sprint)$/i, crouch: /^(crouch|crouch_walk)$/i, death: /^(death|die|dead)$/i,
};

export function chooseClip(clips: THREE.AnimationClip[], kind: AnimationKind) {
  const exact = clips.find(clip => patterns[kind].test(clip.name)) || clips.find(clip => patterns[kind].test(clip.name.split('|').at(-1)!.replace(/^MM_CS5_/i, '')));
  if (exact) return exact;
  if (kind === 'reload') { const full = clips.find(clip => /(?:M4_ReloadFull_type1|FPS_Pistol_Reload_full)$/i.test(clip.name)); if (full) return full; }
  return clips.find(clip => patterns[kind].test(clip.name.split('|').at(-1)!.replace(/^(?:FPS_Pistol_|M4_)/i, '')));
}

export function classifyWeaponMesh(id: string, name: string, materials: string[]) {
  const names = `${name} ${materials.join(' ')}`;
  const background = /background|skybox|skydome|ground_plane|terrain|ambientroom|crosshair|shape_pose/i.test(names) || id === 'cs5' && (/^Copy/.test(name) && !/^Copycs5_handguard_001/.test(name) || ['Object_225', 'Object_229', 'Object_231', 'Object_235', 'Object_237', 'Object_239', 'Object_241', 'Object_243'].includes(name));
  const hands = /arms?|glove|sleeve|knuckle|glowe|bare_arm|skintone|kneepad|cloths|watch|(?:^|[ _])body(?:[ _]|$)/i.test(names) && !/weapon_vm|weapon_rif|weapon_pist|weapon_snip|weapon_smg|body_hd/i.test(names) || id === 'remington870' && materials.includes('material') || id === 'precision-sniper' && materials.includes('TEXTURA');
  return { background, hands };
}

export function allyBehindCover(viewer: Player, target: Player, map: MapId) {
  if (viewer.id === target.id || viewer.team !== target.team || target.hp <= 0) return false;
  const origin = new THREE.Vector3(viewer.x, viewer.y + eyeHeight(viewer.crouch), viewer.z);
  return [0.45, target.crouch ? 0.85 : 1.1, eyeHeight(target.crouch)].some(height => {
    const point = new THREE.Vector3(target.x, target.y + height, target.z); const distance = origin.distanceTo(point);
    return distance > 0.5 && wallHit(new THREE.Ray(origin, point.sub(origin).normalize()), distance, map) < distance - 0.35;
  });
}

export function setTeamOutline(model: THREE.Object3D, team: Team, viewer?: Team, occluded = false) {
  const color = team === viewer && occluded ? team === 'CT' ? '#69afd7' : '#d26e69' : null;
  model.userData.outlineColor = color;
  model.userData.outlineSelected = color !== null;
}

export function configureAllyOutline(pass: OutlinePass, team: Team) {
  pass.visibleEdgeColor.set(0x000000); pass.hiddenEdgeColor.set(team === 'CT' ? '#69afd7' : '#d26e69');
  pass.edgeStrength = 1.7; pass.edgeThickness = 1; pass.edgeGlow = 0; pass.pulsePeriod = 0; pass.usePatternTexture = false;
}

export function modelBounds(model: THREE.Object3D, weaponOnly = false) {
  model.updateMatrixWorld(true);
  model.traverse(object => { if (object instanceof THREE.SkinnedMesh) { object.skeleton.update(); object.computeBoundingBox(); } });
  const bounds = new THREE.Box3();
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !object.visible || weaponOnly && object.userData.hands) return;
    for (let parent = object.parent; parent; parent = parent.parent) if (!parent.visible) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    const box = object instanceof THREE.SkinnedMesh ? object.boundingBox : object.geometry.boundingBox;
    if (box) bounds.union(box.clone().applyMatrix4(object.matrixWorld));
  });
  return bounds;
}

export function stripProjectileGeometry(scene: THREE.Object3D) {
  scene.traverse(object => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const source = object.geometry; const skin = source.getAttribute('skinIndex'); const weights = source.getAttribute('skinWeight');
    if (!skin || !weights) return;
    const removed = new Set(object.skeleton.bones.map((bone, index) => /^(bullets?|quick|projectile|shells?)$/i.test(bone.name) ? index : -1).filter(index => index >= 0));
    if (!removed.size) return;
    const geometry = new THREE.BufferGeometry(); const values = Object.fromEntries(Object.keys(source.attributes).map(name => [name, [] as number[]]));
    const attributes = Object.entries(source.attributes) as [string, THREE.BufferAttribute | THREE.InterleavedBufferAttribute][];
    const groups = source.groups.length ? source.groups : [{ start: 0, count: source.index?.count || source.getAttribute('position').count, materialIndex: 0 }];
    const projectile = (vertex: number) => { let total = 0; for (let component = 0; component < 4; component++) if (removed.has(skin.getComponent(vertex, component))) total += weights.getComponent(vertex, component); return total > 0.01; };
    let count = 0;
    for (const group of groups) {
      const start = count;
      for (let offset = group.start; offset < group.start + group.count; offset += 3) {
        const vertices = [0, 1, 2].map(corner => source.index ? source.index.getX(offset + corner) : offset + corner);
        if (vertices.some(projectile)) continue;
        for (const vertex of vertices) for (const [name, attribute] of attributes) for (let component = 0; component < attribute.itemSize; component++) values[name].push(attribute.getComponent(vertex, component));
        count += 3;
      }
      if (count > start) geometry.addGroup(start, count - start, group.materialIndex);
    }
    for (const [name, attribute] of attributes) geometry.setAttribute(name, new THREE.Float32BufferAttribute(values[name], attribute.itemSize));
    object.geometry = geometry; object.computeBoundingBox(); object.computeBoundingSphere(); source.dispose();
  });
}

function capOpenBoundaries(geometry: THREE.BufferGeometry, indices: number[]) {
  const edges = new Map<string, [number, number] | null>();
  for (let offset = 0; offset < indices.length; offset += 3) for (let edge = 0; edge < 3; edge++) {
    const first = indices[offset + edge]; const second = indices[offset + (edge + 1) % 3]; const key = first < second ? `${first}:${second}` : `${second}:${first}`;
    edges.set(key, edges.has(key) ? null : [first, second]);
  }
  const boundaries = [...edges.values()].filter((edge): edge is [number, number] => !!edge); const remaining = new Set(boundaries.flat());
  const values = Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, Array.from({ length: attribute.count * attribute.itemSize }, (_, index) => attribute.getComponent(Math.floor(index / attribute.itemSize), index % attribute.itemSize))]));
  const start = indices.length;
  while (remaining.size) {
    const vertices = new Set<number>([remaining.values().next().value!]);
    for (const vertex of vertices) { remaining.delete(vertex); for (const edge of boundaries) if (edge.includes(vertex)) edge.forEach(index => vertices.add(index)); }
    if (vertices.size < 3) continue;
    const center = values.position.length / 3;
    for (const [name, attribute] of Object.entries(geometry.attributes)) for (let component = 0; component < attribute.itemSize; component++) {
      const value = name === 'skinIndex' || name === 'skinWeight' ? attribute.getComponent(vertices.values().next().value!, component) : [...vertices].reduce((sum, vertex) => sum + attribute.getComponent(vertex, component), 0) / vertices.size;
      values[name].push(value);
    }
    for (const [first, second] of boundaries) if (vertices.has(first)) indices.push(second, first, center);
  }
  for (const [name, attribute] of Object.entries(geometry.attributes)) geometry.setAttribute(name, new THREE.Float32BufferAttribute(values[name], attribute.itemSize));
  if (indices.length > start) geometry.addGroup(start, indices.length - start, 0);
}

export function normalizeModel(model: THREE.Object3D, role: 'weapon' | 'hands' | 'character' | 'prop', length = 1) {
  const root = new THREE.Group(); const orientation = new THREE.Group(); root.add(orientation); orientation.add(model);
  const weaponOnly = role === 'weapon';
  let bounds = modelBounds(model, weaponOnly); const dimensions = bounds.getSize(new THREE.Vector3());
  if (role === 'character') {
    const pelvis = model.getObjectByName('pelvis'); const head = model.getObjectByName('head_0');
    const left = model.getObjectByName('arm_upper_l'); const right = model.getObjectByName('arm_upper_r');
    if (pelvis && head && left && right) {
      const upward = head.getWorldPosition(new THREE.Vector3()).sub(pelvis.getWorldPosition(new THREE.Vector3())).normalize();
      const across = right.getWorldPosition(new THREE.Vector3()).sub(left.getWorldPosition(new THREE.Vector3())); across.addScaledVector(upward, -across.dot(upward)).normalize();
      const backward = new THREE.Vector3().crossVectors(across, upward).normalize();
      orientation.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, upward, backward).transpose());
    } else if (dimensions.x > dimensions.y) orientation.rotation.z = Math.PI / 2;
    bounds = modelBounds(root); const height = bounds.max.y - bounds.min.y; root.scale.setScalar(length / Math.max(height, 0.001));
    orientation.position.sub(new THREE.Vector3((bounds.min.x + bounds.max.x) / 2, bounds.min.y, (bounds.min.z + bounds.max.z) / 2));
  } else {
    if (dimensions.y >= dimensions.x && dimensions.y >= dimensions.z) orientation.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0)));
    else if (dimensions.x >= dimensions.z) orientation.rotation.y = Math.PI / 2;
    bounds = modelBounds(root, weaponOnly); const size = bounds.getSize(new THREE.Vector3()); root.scale.setScalar(length / Math.max(size.x, size.y, size.z, 0.001));
    orientation.position.sub(bounds.getCenter(new THREE.Vector3()));
  }
  root.updateMatrixWorld(true); return root;
}

export class ModelAnimation {
  readonly mixer: THREE.AnimationMixer;
  private action: THREE.AnimationAction | null = null;
  private kind: string | null = null;
  constructor(readonly scene: THREE.Object3D, readonly clips: THREE.AnimationClip[], private ranges: ActionRanges = {}) { this.mixer = new THREE.AnimationMixer(scene); }
  has(kind: AnimationKind) { return !!chooseClip(this.clips, kind) || !!this.ranges[kind] && this.clips.length === 1; }
  duration(kind: AnimationKind, fallback = 0.5) { const range = this.ranges[kind]; return range ? range[1] - range[0] : chooseClip(this.clips, kind)?.duration || fallback; }
  sample(kind: AnimationKind, progress: number) {
    const range = this.ranges[kind]; const clip = chooseClip(this.clips, kind) || (range && this.clips.length === 1 ? this.clips[0] : undefined); if (!clip) return false;
    return this.sampleClip(clip, range ? (range[0] + THREE.MathUtils.clamp(progress, 0, 1) * (range[1] - range[0])) / Math.max(clip.duration, 0.001) : progress);
  }
  private sampleClip(clip: THREE.AnimationClip, progress: number) {
    if (this.kind !== clip.name) { this.action?.stop(); this.action = this.mixer.clipAction(clip); this.action.reset().setLoop(THREE.LoopOnce, 1); this.action.clampWhenFinished = true; this.action.play(); this.kind = clip.name; }
    this.action!.paused = true; this.action!.time = THREE.MathUtils.clamp(progress, 0, 0.99999) * clip.duration; this.mixer.update(0); return true;
  }
  hold() { return this.sample('idle', 0) || this.sample('fire', 0) || this.sample('draw', 0.9999) || (this.clips.length === 1 && /^(Scene|anims)$/i.test(this.clips[0].name) ? this.sampleClip(this.clips[0], 0) : false); }
  update(time: number, state: { reload: number; inspect: number; shotAge: number; drawAge?: number; swingAge?: number; attack?: number }) {
    if (state.reload > 0 && this.sample('reload', state.reload)) return;
    if (state.inspect >= 0 && state.inspect < 3.4 && this.sample('inspect', state.inspect / 3.4)) return;
    if (state.swingAge !== undefined && state.swingAge >= 0 && state.swingAge < 0.45) {
      const variants = this.clips.filter(clip => patterns.melee.test(clip.name.split('|').at(-1)!));
      if (variants.length && this.sampleClip(variants[(state.attack || 0) % variants.length], state.swingAge / 0.45)) return;
    }
    if (state.shotAge >= 0 && state.shotAge < 0.14 && this.sample('fire', state.shotAge / 0.14)) return;
    const drawDuration = this.duration('draw');
    if (state.drawAge !== undefined && state.drawAge >= 0 && state.drawAge < drawDuration && this.sample('draw', state.drawAge / drawDuration)) return;
    if (this.sample('idle', time % 2 / 2) || this.hold()) return;
    this.action?.stop(); this.action = null; this.kind = null;
  }
  dispose() { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.scene); }
}

export class CharacterMotion {
  private mixer: THREE.AnimationMixer;
  private clips: THREE.AnimationClip[];
  private current: THREE.AnimationAction | null = null;
  private kind = '';
  private solver: CCDIKSolver | null = null;
  private targets: { bone: THREE.Bone; hand: THREE.Bone; wrist: THREE.Quaternion; side: number; mesh: THREE.SkinnedMesh }[] = [];
  private crouched = 0;
  constructor(private asset: THREE.Group, private operator: THREE.Group, private firstPerson = false) {
    const scene = asset.userData.sourceScene as THREE.Object3D;
    this.mixer = new THREE.AnimationMixer(scene);
    const source = asset.userData.animation as ModelAnimation;
    this.clips = [...source.clips];
    asset.updateMatrixWorld(true);
    for (const [name, amplitude, period, crouch] of [['idle', 0, 2, 0], ['walk', 0.42, 0.9, 0], ['run', 0.62, 0.64, 0], ['crouch', 0.19, 1.25, 0.55]] as const) {
      if (chooseClip(this.clips, name)) continue;
      const tracks: THREE.KeyframeTrack[] = [];
      for (const [boneName, side, lower] of [['leg_upper_l', 1, false], ['leg_upper_r', -1, false], ['leg_lower_l', 1, true], ['leg_lower_r', -1, true]] as const) {
        const bone = scene.getObjectByName(boneName); if (!bone) continue;
        const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
        const times = Array.from({ length: 17 }, (_, index) => index / 16 * period); const values: number[] = [];
        for (const time of times) {
          const stride = Math.sin(time / period * Math.PI * 2) * side;
          const angle = lower ? -Math.max(0, stride) * amplitude * 1.2 - crouch * 1.5 : stride * amplitude + crouch;
          const rotation = new THREE.Quaternion().setFromAxisAngle(axis, angle).multiply(bone.quaternion); values.push(rotation.x, rotation.y, rotation.z, rotation.w);
        }
        tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values));
      }
      this.clips.push(new THREE.AnimationClip(name, period, tracks));
    }
    let mesh: THREE.SkinnedMesh | null = null;
    scene.traverse(object => { if (object instanceof THREE.SkinnedMesh) mesh = object; });
    if (mesh) this.attachHands(mesh);
    if (firstPerson) scene.traverse(object => {
      if (!(object instanceof THREE.Bone) || !/^finger_(index|middle|ring|pinky)_[012]_[lr]$/.test(object.name)) return;
      object.rotation.x -= /_0_/.test(object.name) ? 0.22 : /index/.test(object.name) ? 0.36 : 0.7;
    });
  }

  private attachHands(mesh: THREE.SkinnedMesh) {
    mesh.skeleton.boneInverses = mesh.skeleton.boneInverses.map(inverse => inverse.clone());
    const chains = [];
    for (const [suffix, side] of [['l', -1], ['r', 1]] as const) {
      const index = (name: string) => mesh.skeleton.bones.findIndex(bone => bone.name === name);
      const hand = index(`hand_${suffix}`); const lower = index(`arm_lower_${suffix}`); const upper = index(`arm_upper_${suffix}`);
      if (hand < 0 || lower < 0 || upper < 0) continue;
      const bone = new THREE.Bone(); bone.name = `hold_target_${suffix}`; mesh.add(bone); mesh.skeleton.bones.push(bone); mesh.skeleton.boneInverses.push(new THREE.Matrix4());
      this.targets.push({ bone, side, mesh, hand: mesh.skeleton.bones[hand], wrist: mesh.skeleton.bones[hand].quaternion.clone() });
      chains.push({ target: mesh.skeleton.bones.length - 1, effector: hand, iteration: 5, minAngle: 0.005, maxAngle: 0.35, links: [{ index: lower }, { index: upper }] });
    }
    mesh.skeleton.dispose(); mesh.skeleton.boneMatrices = new Float32Array(mesh.skeleton.bones.length * 16);
    if (chains.length) this.solver = new CCDIKSolver(mesh, chains);
  }

  update(dt: number, time: number, speed: number, crouch: boolean, reload: boolean, pitch: number, dead: boolean, weapon: WeaponId = 'rifle') {
    const kind = dead && chooseClip(this.clips, 'death') ? 'death' : dead || speed < 0.2 ? 'idle' : crouch ? 'crouch' : speed > 5.5 ? 'run' : 'walk';
    if (kind !== this.kind) {
      this.current?.fadeOut(0.16); this.current = this.mixer.clipAction(chooseClip(this.clips, kind)!); this.current.reset().setLoop(kind === 'death' ? THREE.LoopOnce : THREE.LoopRepeat, kind === 'death' ? 1 : Infinity).fadeIn(0.16).play(); this.current.clampWhenFinished = kind === 'death'; this.kind = kind;
    }
    this.current!.setEffectiveTimeScale(kind === 'idle' || kind === 'death' ? 1 : Math.max(0.5, speed / (kind === 'run' ? 7 : 4.8))); this.mixer.update(dt);
    this.crouched = THREE.MathUtils.damp(this.crouched, crouch ? 1 : 0, 14, dt);
    this.asset.position.y = -this.crouched * 0.45 + (speed > 0.2 ? Math.sin(time * 12) * 0.012 : Math.sin(time * 2) * 0.004);
    if (dead) return;
    this.operator.updateMatrixWorld(true);
    for (const target of this.targets) {
      if (this.firstPerson) target.hand.quaternion.copy(target.wrist);
      const point = new THREE.Vector3(target.side > 0 ? 0.17 : -0.07, 1.12 - this.crouched * 0.45, target.side > 0 ? -0.22 : -0.53);
      if (this.firstPerson) {
        point.set(target.side > 0 ? 0.025 : -0.045, target.side > 0 ? 1.21 : 1.23, target.side > 0 ? -0.03 : -0.32);
        if (target.side < 0 && WEAPONS[weapon].model === 'pistol') point.set(-0.025, 1.18, -0.06);
        if (target.side < 0 && weapon === 'knife') point.set(-0.29, 1.03, 0.08);
      }
      if (reload && target.side < 0) { point.y -= 0.16 + Math.sin(time * 6) * 0.11; point.z += 0.13; }
      const offset = new THREE.Vector3(0, 0, point.z).applyAxisAngle(new THREE.Vector3(1, 0, 0), pitch); point.y += offset.y; point.z = offset.z;
      this.operator.localToWorld(point); target.mesh.worldToLocal(point); target.bone.position.copy(point);
    }
    this.operator.updateMatrixWorld(true); this.solver?.update();
    if (this.firstPerson) for (const target of this.targets) {
      const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(this.operator.getWorldQuaternion(new THREE.Quaternion()));
      const rotation = target.hand.getWorldQuaternion(new THREE.Quaternion()).premultiply(new THREE.Quaternion().setFromAxisAngle(axis, target.side > 0 ? 1.1 : -0.8));
      target.hand.quaternion.copy(target.hand.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
    }
  }
  dispose() { this.mixer.stopAllAction(); }
}

export class ModelAssets {
  revision = 0;
  manifest: Record<string, AssetEntry> = {};
  onReady: (id: string) => void = () => {};
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private models = new Map<string, Pick<GLTF, 'scene' | 'animations'>>();
  private pending = new Map<string, Promise<boolean>>();
  private initialized: Promise<void> | null = null;

  initialize() {
    return this.initialized ||= fetch('/models/imported/manifest.json').then(response => { if (!response.ok) throw new Error('Model manifest unavailable'); return response.json(); }).then(manifest => {
      this.manifest = { ...manifest, 'field-shotgun': { url: '/models/quaternius-shotgun.fbx', kind: 'weapon', bytes: 0, clips: [], license: null, attribution: 'Existing Quaternius shotgun fallback. Verify the original pack license before redistribution.' }, 'field-revolver': { url: '/models/quaternius-revolver.fbx', kind: 'weapon', bytes: 155852, clips: ['RevolverArmature|Fire', 'RevolverArmature|Reload'], license: '/models/quaternius-revolver-license.txt', attribution: 'Quaternius Animated Guns Pack, CC0. https://quaternius.com/packs/animatedguns.html' } };
    }).catch(error => { console.warn(error.message); });
  }

  async load(id: string): Promise<boolean> {
    if (this.models.has(id)) return true;
    if (this.pending.has(id)) return this.pending.get(id)!;
    const task = this.initialize().then(async () => {
      const asset = this.manifest[id]; if (!asset) return false;
      try {
        let model: Pick<GLTF, 'scene' | 'animations'>;
        if (asset.url.endsWith('.fbx')) {
          const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js'); const scene = await new FBXLoader().loadAsync(asset.url); if (id === 'field-revolver') stripProjectileGeometry(scene); model = { scene, animations: scene.animations };
        } else model = await this.loader.loadAsync(asset.url);
        this.models.set(id, model); this.revision++; this.onReady(id); return true;
      } catch (error) { console.warn(`Model ${id} could not load`, error); return false; }
    });
    this.pending.set(id, task); return task;
  }

  has(id: string) { return this.models.has(id); }
  private pistolArms() {
    const source = this.models.get('deagle-view'); if (!source) return null;
    const scene = clone(source.scene); const rig = new THREE.Group(); rig.add(scene); rig.rotation.y = Math.PI;
    scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.userData.assetShared = true;
      const materials = [object.material].flat(); const classification = classifyWeaponMesh('deagle-view', object.name, materials.map(material => material.name));
      object.visible = classification.hands && !classification.background; object.userData.hands = true; object.frustumCulled = false;
      object.material = materials.map(material => { const copy = material.clone(); const standard = copy as THREE.MeshStandardMaterial; for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'] as const) if (standard[key]) standard[key]!.userData.assetShared = true; return copy; });
      if (object.material.length === 1) object.material = object.material[0];
    });
    const animation = new ModelAnimation(scene, source.animations); animation.hold(); rig.updateMatrixWorld(true);
    const grip = new THREE.Box3();
    scene.traverse(object => {
      if (!(object instanceof THREE.SkinnedMesh) || !object.visible || ![object.material].flat().some(material => /gloves/i.test(material.name))) return;
      object.skeleton.update(); object.computeBoundingBox(); grip.union(object.boundingBox!.clone().applyMatrix4(object.matrixWorld));
    });
    if (grip.isEmpty()) return null;
    rig.position.sub(grip.getCenter(new THREE.Vector3())).add(new THREE.Vector3(0, -0.065, 0.11));
    rig.userData.animation = animation; rig.userData.nativeArms = true; rig.userData.weaponGrip = 'pistol'; rig.userData.assetId = 'authored-pistol-arms';
    return rig;
  }
  viewArms(weapon: WeaponId = 'rifle') {
    const pistol = WEAPONS[weapon].model === 'pistol';
    if (pistol) { const hands = this.pistolArms(); if (hands) return hands; }
    const knife = weapon === 'knife';
    const authored = this.instantiate(knife ? 'knife-flip' : pistol ? 'deagle-view' : 'm4a1s', 'weapon', knife ? 0.34 : pistol ? 0.33 : 0.92, 'view');
    if (authored?.userData.hasHands) {
      authored.traverse(object => { if (object instanceof THREE.Mesh && !object.userData.hands) object.visible = false; });
      authored.userData.assetId = 'authored-arms'; authored.userData.nativeArms = true; authored.userData.weaponGrip = knife ? 'knife' : pistol ? 'pistol' : 'rifle'; return authored;
    }
    const asset = this.instantiate('sas', 'character', 1.78); if (!asset) return null;
    asset.traverse(object => {
      if (!(object instanceof THREE.SkinnedMesh)) return;
      const geometry = object.geometry.clone(); geometry.userData.assetShared = false; object.geometry = geometry;
      const source = geometry.index; if (!source) return;
      const bones = object.skeleton.bones; const skinIndex = geometry.getAttribute('skinIndex'); const skinWeight = geometry.getAttribute('skinWeight');
      const indices: number[] = []; const groups = geometry.groups.length ? [...geometry.groups] : [{ start: 0, count: source.count, materialIndex: 0 }]; geometry.clearGroups();
      const armVertex = (vertex: number) => {
        let weight = 0;
        for (let component = 0; component < 4; component++) if (/^(hand_|finger_|arm_lower_)/.test(bones[skinIndex.getComponent(vertex, component)]?.name || '')) weight += skinWeight.getComponent(vertex, component);
        return weight > 0.7;
      };
      for (const group of groups) {
        const start = indices.length;
        for (let offset = group.start; offset < group.start + group.count; offset += 3) {
          const vertices = [source.getX(offset), source.getX(offset + 1), source.getX(offset + 2)];
          if (vertices.every(armVertex)) indices.push(...vertices);
        }
        if (indices.length > start) geometry.addGroup(start, indices.length - start, group.materialIndex);
      }
      if (!indices.length) { object.visible = false; geometry.setIndex([]); return; }
      capOpenBoundaries(geometry, indices); geometry.setIndex(indices); geometry.computeBoundingBox(); object.frustumCulled = false;
    });
    const arms = new THREE.Group(); const operator = new THREE.Group(); operator.position.set(0, -1.28, 0.14); operator.add(asset); arms.add(operator);
    arms.userData.characterMotion = new CharacterMotion(asset, operator, true); arms.userData.assetId = 'sas-arms'; return arms;
  }
  weaponAsset(id: WeaponId, context: 'view' | 'world' | 'preview' = 'preview') {
    const viewmodels: Partial<Record<WeaponId, string>> = { handCannon: 'handcannon-classic', carbine: 'm4a1s', autoShotgun: 'benelli', servicePistol: 'pistol-fps' };
    return context === 'view' ? viewmodels[id] || WEAPON_ASSETS[id] : WEAPON_ASSETS[id];
  }
  async prepareWeapon(id: WeaponId) {
    await Promise.all([this.load(WEAPON_ASSETS[id]), this.weaponAsset(id, 'view') !== WEAPON_ASSETS[id] ? this.load(this.weaponAsset(id, 'view')) : Promise.resolve(true), WEAPONS[id].model === 'pistol' ? this.load('deagle-view') : Promise.resolve(true)]);
  }

  instantiate(id: string, role: 'weapon' | 'hands' | 'character' | 'prop' | 'map', length = 1, context: 'view' | 'world' | 'preview' = 'preview') {
    const gltf = this.models.get(id); if (!gltf) return null;
    const scene = clone(gltf.scene);
    scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.userData.assetShared = true;
      object.material = (Array.isArray(object.material) ? object.material : [object.material]).map(original => {
        const material = original instanceof THREE.MeshStandardMaterial ? original.clone() : new THREE.MeshStandardMaterial({
          color: (original as THREE.MeshPhongMaterial).color?.clone() || new THREE.Color('#aeb4b5'), map: (original as THREE.MeshPhongMaterial).map || null,
          transparent: original.transparent, opacity: original.opacity, side: original.side, roughness: 0.65, metalness: 0.15,
        }); material.name = original.name;
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const) if (material[key]) material[key]!.userData.assetShared = true;
        if ('roughness' in material) { material.roughness = Math.max(0.28, material.roughness); material.envMapIntensity = 0.65; }
        material.userData.dryRoughness = material.roughness;
        if (role === 'map') {
          material.side = THREE.DoubleSide;
          if (material.opacity >= 0.99 && /wall|pavement|atlas|brick|wood|floor/i.test(material.name)) material.transparent = false;
          material.depthWrite = !material.transparent;
        }
        return material;
      });
      if (object.material.length === 1) object.material = object.material[0];
      object.castShadow = true; object.receiveShadow = true; object.frustumCulled = !(object instanceof THREE.SkinnedMesh);
      const names = [object.material].flat().map(material => material.name); const materialNames = names.join(' ');
      const classification = classifyWeaponMesh(id, object.name, names);
      object.userData.hands = classification.hands;
      if (role !== 'map' && classification.background) object.visible = false;
      if (role === 'weapon' && context !== 'view' && classification.hands) object.visible = false;
      if (role === 'hands') {
        const names = `${object.name} ${materialNames}`;
        if (/knife|karam|stattrak|uid|m4a1|silencer/i.test(names) && !/glove|arms|sleeve|hand|glowe/i.test(names)) object.visible = false;
      }
    });
    const animation = new ModelAnimation(scene, gltf.animations, MODEL_ACTION_RANGES[id]);
    if (role === 'weapon') animation.hold();
    const normalized = role === 'map' ? new THREE.Group().add(scene) : normalizeModel(scene, role, length);
    if (role === 'weapon') normalized.rotation.y = WEAPON_YAW[id] ?? Math.PI;
    if (role === 'weapon' && context === 'view') {
      normalized.updateMatrixWorld(true);
      scene.traverse(object => {
        if (!(object instanceof THREE.Mesh) || !object.userData.hands || !object.visible) return;
        if (object instanceof THREE.SkinnedMesh) { object.skeleton.update(); object.computeBoundingBox(); }
        else if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        const bounds = (object instanceof THREE.SkinnedMesh ? object.boundingBox : object.geometry.boundingBox)!.clone().applyMatrix4(object.matrixWorld);
        const size = bounds.getSize(new THREE.Vector3());
        if (![...size].every(Number.isFinite) || Math.max(size.x, size.y, size.z) > Math.max(1.8, length * 3)) object.visible = false;
      });
    }
    normalized.userData.baseYaw = normalized.rotation.y;
    const model = role === 'weapon' ? new THREE.Group().add(normalized) : normalized; model.name = `imported-${id}`;
    if (role === 'weapon') { normalized.name = 'asset-motion'; model.userData.motion = normalized; }
    model.userData.assetId = id; model.userData.imported = true; model.userData.animation = animation; model.userData.sourceScene = scene;
    model.userData.drawDuration = animation.duration('draw');
    model.userData.hasHands = false; scene.traverse(object => { if (object.userData.hands && object.visible && role === 'weapon' && context === 'view') model.userData.hasHands = true; });
    model.userData.forward = new THREE.Vector3(0, 0, -1);
    return model;
  }

  weapon(id: WeaponId, context: 'view' | 'world' | 'preview' = 'preview') {
    const asset = this.weaponAsset(id, context);
    if (!this.has(asset)) { if (context === 'view') void this.prepareWeapon(id); else void this.load(asset); return null; }
    const kind = WEAPONS[id].model;
    const length = kind === 'knife' ? 0.34 : kind === 'pistol' ? 0.33 : kind === 'sniper' ? 1.12 : kind === 'smg' ? 0.68 : 0.92;
    const model = this.instantiate(asset, 'weapon', length, context)!; model.userData.weapon = id;
    const bounds = modelBounds(model, true); const center = bounds.getCenter(new THREE.Vector3());
    const socket = new THREE.Object3D(); socket.name = 'muzzle-socket'; socket.position.set(center.x, center.y + (bounds.max.y - bounds.min.y) * 0.2, bounds.min.z);
    const motion = model.userData.motion as THREE.Group; motion.worldToLocal(socket.position); motion.add(socket);
    model.userData.muzzle = bounds.min.z;
    return model;
  }
}

export const assets = new ModelAssets();