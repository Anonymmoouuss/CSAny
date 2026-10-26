import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { MAPS, MAP_SIZE, DISTRICTS, WEAPONS, eyeHeight, getSites, scopedFov, type MapId, type Player, type Snapshot, type Vec, type WeaponId } from '../shared/game.ts';
import { CHARM_BY_ID, SKIN_BY_ID, type CharmId, type SkinAppearance } from '../shared/economy.ts';
import { buildWeapon, animateWeapon, charmPendant, disposeWeapon, knifeHoldPose, meleePose } from './weapons.ts';
import { assets, allyBehindCover, configureAllyOutline, modelBounds, setTeamOutline, CharacterMotion, type ModelAnimation } from './assets.ts';
import { isBombRound, matchLineup } from '../shared/round.ts';
import { smokeCellVisible } from '../shared/equipment.ts';
import { mapGeometry, registerMapGeometry } from '../shared/map-geometry.ts';

export const SKINS = [
  { name: 'WASTELAND', finish: 'FIELD-TESTED', primary: '#b0c777', accent: '#e8eeac', dark: '#333f37' },
  { name: 'HOTLINE', finish: 'FACTORY NEW', primary: '#ed705c', accent: '#ffe1a5', dark: '#3a2c39' },
  { name: 'BLUE STEEL', finish: 'MINIMAL WEAR', primary: '#72b8ce', accent: '#d1edf4', dark: '#243d53' },
  { name: 'VOLTAGE', finish: 'FACTORY NEW', primary: '#e3d943', accent: '#f8f0a7', dark: '#3c4231' },
  { name: 'MONSOON', finish: 'FIELD-TESTED', primary: '#559a87', accent: '#c5ead0', dark: '#263f3b' },
  { name: 'AFTERBURN', finish: 'WELL-WORN', primary: '#d44f43', accent: '#f5c174', dark: '#402b34' },
  { name: 'ORBITAL', finish: 'FACTORY NEW', primary: '#b48bc5', accent: '#edcde5', dark: '#34344d' },
  { name: 'GLACIER', finish: 'MINIMAL WEAR', primary: '#93cbd5', accent: '#e0f5e9', dark: '#385264' },
  { name: 'SANDSTORM', finish: 'FIELD-TESTED', primary: '#c89a62', accent: '#e8d69e', dark: '#4c4134' },
  { name: 'CARBON', finish: 'FACTORY NEW', primary: '#858d8b', accent: '#d6dbd4', dark: '#292f31' },
  { name: 'WILDFIRE', finish: 'WELL-WORN', primary: '#e36f39', accent: '#f3d582', dark: '#393630' },
  { name: 'TIDELINE', finish: 'MINIMAL WEAR', primary: '#658daf', accent: '#c3dee2', dark: '#293b4d' },
];
const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.08 });
const metalMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.65 });

function tint(geometry: THREE.BufferGeometry, color: string | number, variation = 0.035) {
  const base = new THREE.Color(color);
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  for (let index = 0; index < positions.count; index++) {
    const shade = 1 + Math.sin(Math.floor(index / 4) * 91.7 + positions.getX(index) * 13) * variation;
    colors[index * 3] = base.r * shade; colors[index * 3 + 1] = base.g * shade; colors[index * 3 + 2] = base.b * shade;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function box(parent: THREE.Object3D, size: number[], position: number[], color: string | number, rotation?: number[]) {
  const mesh = new THREE.Mesh(tint(new THREE.BoxGeometry(...size as [number, number, number]), color), material);
  mesh.position.set(...position as [number, number, number]);
  if (rotation) mesh.rotation.set(...rotation as [number, number, number]);
  mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}

function cylinder(parent: THREE.Object3D, radius: number, length: number, position: number[], color: string | number, rotation?: number[], topRadius = radius) {
  const mesh = new THREE.Mesh(tint(new THREE.CylinderGeometry(topRadius, radius, length, 8), color), material);
  mesh.position.set(...position as [number, number, number]);
  if (rotation) mesh.rotation.set(...rotation as [number, number, number]);
  mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}

function bake(group: THREE.Group, targetMaterial = material) {
  group.updateMatrixWorld(true);
  const geometries: THREE.BufferGeometry[] = [];
  group.traverse(object => {
    if (object instanceof THREE.Mesh) {
      const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
      geometry.deleteAttribute('uv');
      geometries.push(geometry.index ? geometry.toNonIndexed() : geometry);
      object.geometry.dispose();
    }
  });
  const mesh = new THREE.Mesh(mergeGeometries(geometries), targetMaterial);
  for (const geometry of geometries) geometry.dispose();
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

function surfaceTexture(kind: 'stone' | 'metal' | 'ground') {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d')!; context.fillStyle = '#ddd9cd'; context.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 128; row += 2) for (let column = 0; column < 128; column += 2) {
    context.fillStyle = `rgba(20,25,24,${((column * 71 + row * 37) % 23) / 160})`; context.fillRect(column, row, 2, 2);
  }
  context.strokeStyle = kind === 'metal' ? '#778380' : '#a6a293'; context.lineWidth = 1;
  if (kind === 'metal') for (let column = 2; column < 128; column += 16) { context.beginPath(); context.moveTo(column, 0); context.lineTo(column, 128); context.stroke(); }
  else for (let row = 0; row < 128; row += kind === 'ground' ? 64 : 32) {
    const height = kind === 'ground' ? 64 : 32; context.beginPath(); context.moveTo(0, row); context.lineTo(128, row); context.stroke();
    for (let column = (row / height % 2) * 32; column < 128; column += 64) { context.beginPath(); context.moveTo(column, row); context.lineTo(column, row + height); context.stroke(); }
  }
  const texture = new THREE.CanvasTexture(canvas); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}

function bakeMap(group: THREE.Group) {
  const buckets: THREE.BufferGeometry[][] = [[], [], []]; group.updateMatrixWorld(true);
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const original = object.geometry.clone().applyMatrix4(object.matrixWorld); const geometry = original.index ? original.toNonIndexed() : original;
    if (original !== geometry) original.dispose();
    if (!geometry.getAttribute('color')) tint(geometry, (object.material as THREE.MeshBasicMaterial).color.getHex(), 0);
    const positions = geometry.getAttribute('position'); const normals = geometry.getAttribute('normal'); const colors = geometry.getAttribute('color'); const uvs = new Float32Array(positions.count * 2);
    for (let index = 0; index < positions.count; index++) {
      const height = positions.getY(index); const upward = Math.abs(normals.getY(index)) > 0.6; const sideways = Math.abs(normals.getX(index)) > 0.6;
      uvs[index * 2] = (upward ? positions.getX(index) : sideways ? positions.getZ(index) : positions.getX(index)) / 3;
      uvs[index * 2 + 1] = (upward ? positions.getZ(index) : height) / 3;
      const ambient = 0.76 + Math.min(1, Math.max(0, height) / 3) * 0.16 + Math.max(0, normals.getY(index)) * 0.08;
      colors.setXYZ(index, colors.getX(index) * ambient, colors.getY(index) * ambient, colors.getZ(index) * ambient);
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); buckets[object.userData.surface === 'ground' ? 2 : object.userData.surface === 'metal' ? 1 : 0].push(geometry); object.geometry.dispose();
  });
  const root = new THREE.Group();
  for (const [index, geometries] of buckets.entries()) if (geometries.length) {
    const texture = surfaceTexture(index === 0 ? 'stone' : index === 1 ? 'metal' : 'ground');
    const surface = new THREE.MeshStandardMaterial({ vertexColors: true, map: texture, bumpMap: texture, bumpScale: index === 1 ? 0.025 : 0.065, roughness: index === 1 ? 0.45 : 0.9, metalness: index === 1 ? 0.62 : 0.02 }); surface.userData.dryRoughness = surface.roughness;
    const mesh = new THREE.Mesh(mergeGeometries(geometries), surface); mesh.castShadow = index !== 2; mesh.receiveShadow = true; root.add(mesh); geometries.forEach(geometry => geometry.dispose());
  }
  return root;
}

function label(parent: THREE.Object3D, letter: 'A' | 'B', position: number[], size: number, rotation = 0) {
  const group = new THREE.Group();
  const color = '#cf643e';
  if (letter === 'A') {
    box(group, [0.15, 1.5, 0.035], [-0.28, 0, 0], color, [0, 0, -0.35]);
    box(group, [0.15, 1.5, 0.035], [0.28, 0, 0], color, [0, 0, 0.35]);
    box(group, [0.68, 0.14, 0.035], [0, -0.16, 0], color);
  } else {
    box(group, [0.14, 1.45, 0.035], [-0.4, 0, 0], color);
    for (const height of [-0.65, 0, 0.65]) box(group, [0.65, 0.14, 0.035], [-0.06, height, 0], color);
    for (const height of [-0.32, 0.32]) box(group, [0.14, 0.65, 0.035], [0.3, height, 0], color);
  }
  group.scale.setScalar(size); group.position.set(...position as [number, number, number]); group.rotation.y = rotation; parent.add(group);
}

function palm(parent: THREE.Object3D, x: number, z: number, height: number) {
  cylinder(parent, 0.24, height, [x, height / 2, z], '#8f7953', [0, 0, -0.06], 0.14);
  for (let index = 0; index < 8; index++) {
    const angle = index / 8 * Math.PI * 2;
    const leaf = new THREE.Group();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, -0.42, 0.5, 1.4, 0.42, 0.5, 1.4,
      -0.42, 0.5, 1.4, 0, -0.5, 3.2, 0.42, 0.5, 1.4,
      0.42, 0.5, 1.4, -0.42, 0.5, 1.4, 0, 0, 0,
      0.42, 0.5, 1.4, 0, -0.5, 3.2, -0.42, 0.5, 1.4,
    ], 3));
    geometry.computeVertexNormals();
    leaf.add(new THREE.Mesh(tint(geometry, index % 2 ? '#5e7952' : '#6e8955'), material));
    leaf.position.set(x, height, z); leaf.rotation.y = angle; parent.add(leaf);
  }
}

function makeMap(mapId: MapId) {
  const map = MAPS[mapId];
  const group = new THREE.Group();
  if (map.imported) {
    const model = assets.instantiate(map.imported.assetId, 'map');
    if (!model) return group;
    model.applyMatrix4(new THREE.Matrix4().fromArray(map.imported.transform)); group.add(model); group.userData.assetId = map.imported.assetId;
    for (const site of getSites(mapId)) {
      const zone = new THREE.Mesh(new THREE.RingGeometry(3.9, 3.98, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: map.palette.accent, transparent: true, opacity: 0.7, depthWrite: false }));
      zone.position.set(site.x, site.y + 0.025, site.z); group.add(zone);
      zone.userData.bombSite = true;
      const marking = new THREE.Group(); label(marking, site.name === 'B' ? 'B' : 'A', [0, 0, 0], 1.8); marking.rotation.x = -Math.PI / 2; marking.position.set(site.x, site.y + 0.04, site.z); group.add(marking);
      marking.userData.bombSite = true;
    }
    const points = mapGeometry(mapId)?.metadata.navigation || [...map.imported.spawns.T, ...map.imported.spawns.CT];
    const bounds = new THREE.Box3().setFromPoints(points.map(point => new THREE.Vector3(point.x, point.y, point.z)));
    group.userData.focus = bounds.getCenter(new THREE.Vector3()); group.userData.span = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z, 20);
    return group;
  }
  if (mapId === 'training') {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#718a7e', roughness: 0.95 })); floor.receiveShadow = true; group.add(floor);
    for (const solid of map.solids) box(group, [solid.w, solid.h, solid.d], [solid.x, solid.y, solid.z], solid.z === -28 ? '#d2ddd0' : solid.kind === 'crate' ? '#4b736c' : '#819b8b');
    for (const distance of [5, 10, 15, 20, 30, 40]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(43, 0.075).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: distance % 10 ? '#adc7b4' : '#e6cd83' })); line.position.set(0, 0.012, 16 - distance); group.add(line);
      const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
      const context = canvas.getContext('2d')!; context.fillStyle = '#e5edcf'; context.font = '36px Barlow'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(`${distance}M`, 64, 32);
      const marker = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }));
      marker.position.set(-21, 0.018, 16 - distance); marker.rotation.x = -Math.PI / 2; group.add(marker);
    }
    const board = new THREE.Group(); board.position.set(0, 3, -27.57);
    for (let ring = 1; ring <= 5; ring++) { const circle = new THREE.Mesh(new THREE.RingGeometry(ring * 0.42, ring * 0.42 + 0.025, 64), new THREE.MeshBasicMaterial({ color: ring % 2 ? '#ac574d' : '#456e64', side: THREE.DoubleSide })); board.add(circle); }
    group.add(board); group.userData.focus = new THREE.Vector3(0, 1, -4); group.userData.span = 64; return group;
  }
  const groundGeometry = new THREE.PlaneGeometry(MAP_SIZE * 2 + 80, MAP_SIZE * 2 + 80, 40, 40).rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(tint(groundGeometry, map.palette.ground, 0.065), material);
  ground.receiveShadow = true; ground.userData.surface = 'ground'; group.add(ground);
  for (const solid of map.solids) {
    const crate = solid.kind === 'crate';
    const cover = box(group, [solid.w, solid.h, solid.d], [solid.x, solid.y, solid.z], crate ? map.palette.trim : solid.kind === 'step' ? map.palette.ground : map.palette.wall);
    if (mapId === 'foundry' && crate) cover.userData.surface = 'metal';
    if (crate) {
      for (const offset of [-0.5, 0.5]) {
        box(group, [solid.w + 0.05, 0.1, solid.d + 0.05], [solid.x, solid.y + solid.h * offset * 0.76, solid.z], map.palette.trim);
        box(group, [0.1, solid.h + 0.03, solid.d + 0.06], [solid.x + solid.w * offset * 0.77, solid.y, solid.z], map.palette.trim);
      }
      for (let index = 1; index < 5; index++) box(group, [0.025, solid.h, solid.d + 0.008], [solid.x - solid.w / 2 + solid.w * index / 5, solid.y, solid.z], map.palette.trim);
      box(group, [0.48, 0.35, 0.02], [solid.x, solid.y + 0.25, solid.z + solid.d / 2 + 0.04], map.palette.accent);
    } else if (solid.kind === 'wall') {
      box(group, [solid.w + 0.08, 0.18, solid.d + 0.08], [solid.x, solid.y + solid.h / 2 - 0.07, solid.z], map.palette.trim);
      box(group, [solid.w + 0.02, 0.55, solid.d + 0.02], [solid.x, 0.28, solid.z], map.palette.trim);
      for (let index = 0; index < Math.floor(solid.w / 3); index++) {
        box(group, [0.012, solid.h - 0.7, solid.d + 0.025], [solid.x - solid.w / 2 + index * 3, solid.y, solid.z], map.palette.wall);
      }
      if (solid.h > 4 && solid.w > 8 && solid.w < 50) for (let offset = -solid.w / 2 + 2.5; offset < solid.w / 2 - 1; offset += 4.5) {
        box(group, [1.6, 1.8, 0.06], [solid.x + offset, solid.y + 0.7, solid.z - solid.d / 2 - 0.04], mapId === 'foundry' ? '#617f82' : '#587d79');
        box(group, [1.9, 0.13, 0.18], [solid.x + offset, solid.y - 0.25, solid.z - solid.d / 2 - 0.1], map.palette.trim);
      }
    }
  }
  for (const [index, site] of getSites(mapId).entries()) {
    const zone = new THREE.Mesh(tint(new THREE.RingGeometry(4.6, 4.66, 64).rotateX(-Math.PI / 2), map.palette.accent), material);
    zone.position.set(site.x, 0.015, site.z); group.add(zone);
    const marking = new THREE.Group(); label(marking, index ? 'B' : 'A', [0, 0, 0], 2.4); marking.rotation.x = -Math.PI / 2; marking.position.set(site.x, 0.04, site.z); group.add(marking);
    label(group, index ? 'B' : 'A', [site.x, 2.8, site.z < 0 ? -MAP_SIZE + 0.65 : MAP_SIZE - 0.65], 1.6, site.z < 0 ? 0 : Math.PI);
  }
  const decorationStart = group.children.length;
  if (mapId === 'dustline') {
  for (let index = 0; index < 9; index++) {
    const x = -39 + index * 10;
    const height = 6 + ((index * 17) % 5);
    box(group, [9.8, height, 6], [x, height / 2, -45], index % 3 ? '#c2b69c' : '#b3b3a0');
    box(group, [10, 0.22, 6.2], [x, height, -45], '#e0d3b3');
    for (let level = 0; level < Math.floor(height / 2.5); level++) {
      for (const offset of [-1.7, 1.7]) {
        box(group, [1.05, 1.5, 0.1], [x + offset, 1.6 + level * 2.6, -41.94], '#4c6967');
        box(group, [1.22, 0.12, 0.24], [x + offset, 0.8 + level * 2.6, -41.8], '#dfd1b0');
        box(group, [0.06, 1.5, 0.11], [x + offset, 1.6 + level * 2.6, -41.85], '#9aaf9b');
      }
    }
    box(group, [5.8, 7.2, 9.8], [-45, 3.6, x], index % 2 ? '#c0b69b' : '#d4c2a0');
    box(group, [5.8, 6.2, 9.8], [45, 3.1, x], '#c8baa1');
  }
  for (const [x, z, height] of [[-44, -20, 7], [44, 19, 7.8], [-44, 20, 7.2], [44, -21, 8], [-44, -12, 9], [44, 4, 9]]) palm(group, x, z, height);
  for (let index = 0; index < 3; index++) {
    const fabric = new THREE.Mesh(tint(new THREE.PlaneGeometry(4, 5, 5, 5), index % 2 ? '#729691' : '#e4d7b6'), material);
    fabric.rotation.x = -Math.PI / 2 + 0.13; fabric.position.set(-15 + index * 4, 5.5, -19);
    const positions = fabric.geometry.getAttribute('position');
    for (let vertex = 0; vertex < positions.count; vertex++) positions.setZ(vertex, Math.sin(positions.getX(vertex) * 3) * 0.1);
    fabric.geometry.computeVertexNormals(); group.add(fabric);
  }
  for (const x of [-21, -3]) cylinder(group, 0.06, 5.6, [x, 2.8, -18.5], '#3c504b');
  for (let index = 0; index < 80; index++) {
    const x = Math.sin(index * 127.1) * 22;
    const z = Math.cos(index * 311.7) * 22;
    box(group, [0.05 + (index % 3) * 0.03, 0.035, 0.09], [x, 0.02, z], index % 2 ? '#b9a784' : '#e5d5b0', [0, index, 0]);
  }
  const arch = new THREE.Mesh(tint(new THREE.TorusGeometry(2.3, 0.36, 6, 20, Math.PI), '#b6a184'), material);
  arch.position.set(0, 3.4, -40.7); group.add(arch);
  for (const x of [-2.3, 2.3]) box(group, [0.72, 3.4, 0.72], [x, 1.7, -40.7], '#b6a184');
  box(group, [3.7, 3.2, 0.05], [0, 1.6, -40.9], '#536b65');
  } else if (mapId === 'foundry') {
    for (const x of [-13, 13]) {
      for (const offset of [-1.5, 1.5]) box(group, [0.12, 0.09, 73], [x + offset, 0.045, 0], '#84948b').userData.surface = 'metal';
      for (let z = -35; z <= 35; z += 2) box(group, [4, 0.05, 0.24], [x, 0.025, z], '#484e46');
    }
    for (const x of [-18, 18]) {
      cylinder(group, 0.22, 14, [x, 7, 0], map.palette.trim, [Math.PI / 2, 0, 0]);
      for (const z of [-15, 15]) box(group, [0.5, 7, 0.5], [x, 3.5, z], map.palette.trim);
    }
    box(group, [38, 0.55, 0.7], [0, 9, -15], map.palette.trim);
    box(group, [38, 0.55, 0.7], [0, 9, 15], map.palette.trim);
    for (const x of [-44, 44]) cylinder(group, 1.4, 21, [x, 10.5, -35], '#687b73').userData.surface = 'metal';
  } else if (mapId === 'tidebreak') {
    for (const x of [-9, 9]) box(group, [2.8, 11, 5], [x, 5.5, -44], map.palette.wall);
    box(group, [23, 1.2, 6], [0, 11.5, -44], map.palette.wall);
    for (let index = 0; index < 9; index++) {
      const x = -20 + index * 5;
      cylinder(group, 0.18, 0.55, [x, 0.28, -21], map.palette.trim);
      cylinder(group, 0.18, 0.55, [x, 0.28, 21], map.palette.trim);
    }
    for (const [x, z] of [[-44, -14], [44, 14], [-44, 14], [44, -14]]) {
      cylinder(group, 0.32, 1.25, [x, 0.62, z], '#607a76');
      box(group, [0.66, 0.08, 0.66], [x, 1.26, z], map.palette.accent);
    }
    for (let index = 0; index < 5; index++) box(group, [0.1, 0.1, 3.8], [-21 + index * 0.24, 0.12, -1], '#c0b48f');
  } else {
    for (const side of [-1, 1]) for (let z = -30; z <= 30; z += 12) {
      for (const offset of [-2.5, 2.5]) cylinder(group, 0.42, 5.5, [side * 40.8, 2.75, z + offset], '#d5c4a2');
      const arch = new THREE.Mesh(tint(new THREE.TorusGeometry(2.5, 0.4, 6, 12, Math.PI), '#d5c4a2'), material); arch.rotation.y = Math.PI / 2; arch.position.set(side * 40.8, 5.4, z); group.add(arch);
    }
    for (const side of [-1, 1]) for (const z of [-28, 28]) { cylinder(group, 2, 11, [side * 45, 5.5, z], '#d5c4a2'); cylinder(group, 2.9, 3.5, [side * 45, 12.7, z], '#498a82', undefined, 0.2); }
    const stalls: [number, number, string][] = [[-44, -17, '#d28a58'], [44, 17, '#70a7a2'], [-44, 17, '#d9bf77'], [44, -17, '#8497b1']];
    for (const [x, z, color] of stalls) {
      for (const side of [-1, 1]) {
        box(group, [0.13, 3.4, 0.13], [x + side * 1.8, 1.7, z], map.palette.trim);
        box(group, [1.9, 0.13, 0.13], [x, 3.2, z], map.palette.trim);
      }
      box(group, [4.1, 0.16, 3.5], [x, 3.35, z], color, [0.05, 0, 0.04]);
      box(group, [2.3, 0.12, 0.08], [x, 2.25, z + 1.86], color);
    }
    for (let index = 0; index < 8; index++) {
      const x = -19 + index * 5.4;
      cylinder(group, 0.045, 4.8, [x, 2.4, -20], map.palette.trim);
      const lantern = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), new THREE.MeshBasicMaterial({ color: index % 2 ? '#e7b66d' : '#80d4d3' }));
      lantern.position.set(x, 4.7, -20); group.add(lantern);
    }
  }
  for (const decoration of group.children.slice(decorationStart)) {
    if (Math.abs(decoration.position.x) >= 40) decoration.position.x += Math.sign(decoration.position.x) * (MAP_SIZE - 40);
    if (Math.abs(decoration.position.z) >= 40) decoration.position.z += Math.sign(decoration.position.z) * (MAP_SIZE - 40);
  }
  for (const district of DISTRICTS) {
    for (const side of [-1, 1]) {
      box(group, [0.12, 0.02, 48], [district.x + side * 32, 0.018, district.z], mapId === 'foundry' ? '#cfb266' : '#b8c0a1');
      if (mapId === 'foundry') {
        for (const offset of [-1.4, 1.4]) box(group, [0.09, 0.05, 50], [district.x + side * 25 + offset, 0.025, district.z], '#95a69b').userData.surface = 'metal';
        for (let offset = -24; offset <= 24; offset += 3) box(group, [3.4, 0.04, 0.25], [district.x + side * 25, 0.02, district.z + offset], '#4e5a4f');
      } else if (mapId === 'nightmarket') {
        const arch = new THREE.Mesh(tint(new THREE.TorusGeometry(3, 0.25, 8, 24, Math.PI), '#dbcca9'), material); arch.position.set(district.x, 6, district.z + side * 17); group.add(arch);
        box(group, [8.5, 0.18, 1.6], [district.x, 7.7, district.z + side * 17], '#7eaa9a');
      } else if (mapId === 'tidebreak') {
        box(group, [0.13, 0.025, 7], [district.x + side * 26, 0.025, district.z + 21], '#dae5ca');
        box(group, [5, 0.025, 0.13], [district.x + side * 26, 0.025, district.z + 24.5], '#dae5ca');
      }
    }
  }
  return bakeMap(group);
}

function makeWeapon(id: WeaponId, skinIndex: number, knifeStyle = 0, context: 'view' | 'world' | 'preview' = 'view') {
  return buildWeapon(id, undefined, knifeStyle, undefined, context);
}

function makeArms() {
  const arms = new THREE.Group();
  cylinder(arms, 0.052, 0.34, [0.09, -0.22, 0.28], '#69735d', [-0.75, 0, -0.18]);
  cylinder(arms, 0.052, 0.4, [-0.16, -0.17, 0.03], '#69735d', [-1.15, -0.5, 0.5]);
  box(arms, [0.095, 0.11, 0.1], [0.02, -0.1, 0.11], '#303d36', [-0.2, 0, 0]);
  box(arms, [0.085, 0.08, 0.12], [-0.045, -0.045, -0.27], '#303d36', [-0.1, 0, 0]);
  for (let index = 0; index < 3; index++) box(arms, [0.019, 0.07, 0.042], [-0.046 + index * 0.025, -0.065, -0.28], '#465248');
  return bake(arms);
}

function character(team: Player['team'], skin: number) {
  const root = new THREE.Group();
  const supplied = assets.instantiate(skin >= 10 && assets.has('robot') ? 'robot' : team === 'T' && assets.has('sas-red') ? 'sas-red' : 'sas', 'character', 1.78);
  if (supplied) {
    root.add(supplied); root.userData.characterMotion = new CharacterMotion(supplied, root); root.userData.imported = true;
    supplied.traverse(object => { if (object instanceof THREE.Mesh) for (const material of [object.material].flat() as THREE.MeshStandardMaterial[]) if (/ctm_sas_body/i.test(material.name)) material.color.multiply(new THREE.Color(team === 'CT' ? '#d8edf0' : '#efe1bc')); });
    return root;
  }
  const torso = new THREE.Group();
  const uniform = team === 'CT' ? '#3e6669' : '#ad8058';
  box(torso, [0.48, 0.64, 0.34], [0, 1.02, 0], uniform);
  box(torso, [0.51, 0.42, 0.38], [0, 1.09, 0], '#354944');
  box(torso, [0.3, 0.33, 0.1], [0, 1.07, 0.23], '#42524a');
  for (const x of [-0.14, 0, 0.14]) box(torso, [0.1, 0.17, 0.08], [x, 1, -0.23], '#667257');
  box(torso, [0.34, 0.36, 0.33], [0, 1.53, 0], team === 'CT' ? '#3b5551' : '#927f65');
  box(torso, [0.27, 0.09, 0.02], [0, 1.56, -0.174], '#1b3031');
  box(torso, [0.17, 0.05, 0.03], [0, 1.56, -0.19], '#a2bbc0');
  const body = bake(torso); body.name = 'torso'; root.add(body);
  const arms: THREE.Group[] = [];
  for (const x of [-0.34, 0.34]) {
    const arm = new THREE.Group(); box(arm, [0.18, 0.36, 0.2], [0, -0.14, -0.06], uniform, [-0.4, 0, x]); box(arm, [0.16, 0.17, 0.32], [x < 0 ? 0.12 : -0.05, -0.27, -0.24], uniform, [-0.35, x, 0]); box(arm, [0.13, 0.12, 0.13], [x < 0 ? 0.2 : -0.05, -0.29, -0.41], '#303c36');
    const pivot = new THREE.Group(); pivot.add(bake(arm)); pivot.position.set(x, 1.27, 0); root.add(pivot); arms.push(pivot);
  }
  root.userData.arms = arms;
  const legs: THREE.Object3D[] = [];
  for (const x of [-0.14, 0.14]) {
    const leg = new THREE.Group();
    box(leg, [0.2, 0.62, 0.23], [0, -0.3, 0], uniform);
    box(leg, [0.22, 0.16, 0.32], [0, -0.58, -0.04], '#303c36');
    const pivot = new THREE.Group(); pivot.add(bake(leg)); pivot.position.set(x, 0.68, 0); root.add(pivot); legs.push(pivot);
  }
  root.userData.legs = legs;
  return root;
}

type Particle = { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number; max: number; kind: 'spark' | 'shell' | 'tracer' | 'decal' | 'smoke' | 'flash' };
const sparkGeometry = new THREE.BoxGeometry(0.035, 0.035, 0.035);
const shellGeometry = new THREE.CylinderGeometry(0.012, 0.012, 0.045, 5);
const tracerMaterial = new THREE.MeshBasicMaterial({ color: '#ffe8aa', transparent: true, opacity: 0.65 });
const sparkMaterial = new THREE.MeshBasicMaterial({ color: '#e8c282' });
const shellMaterial = new THREE.MeshStandardMaterial({ color: '#bd9e51', metalness: 0.6, roughness: 0.4 });
const decalMaterial = new THREE.MeshBasicMaterial({ color: '#534b39', transparent: true, opacity: 0.65, depthWrite: false });

function flashTexture() {
  const size = 96; const pixels = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const x = (column + 0.5) / size * 2 - 1; const y = (row + 0.5) / size * 2 - 1; const radius = Math.hypot(x, y); const angle = Math.atan2(y, x);
    const edge = 0.6 + Math.cos(angle * 5) * 0.17 + Math.sin(angle * 9) * 0.06;
    const flame = Math.pow(Math.max(0, 1 - radius / edge), 1.4); const core = Math.exp(-radius * radius * 65); const offset = (row * size + column) * 4;
    pixels.set([255, Math.round(115 + 140 * Math.min(1, core + flame)), Math.round(28 + 227 * core), Math.round(Math.min(1, core + flame * 0.85) * 255)], offset);
  }
  const texture = new THREE.DataTexture(pixels, size, size); texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true; texture.name = 'original-muzzle-starburst'; return texture;
}
const muzzleTexture = flashTexture();
const flashSize = (weapon: WeaponId) => WEAPONS[weapon].model === 'sniper' ? 0.28 : WEAPONS[weapon].model === 'shotgun' ? 0.24 : WEAPONS[weapon].model === 'pistol' ? 0.14 : WEAPONS[weapon].model === 'smg' ? 0.17 : 0.21;
export function supplyCaseModel(color: string) {
  const root = new THREE.Group(); root.name = 'supply-case-3d';
  box(root, [1.3, 0.53, 0.8], [0, -0.05, 0], color);
  box(root, [1.34, 0.1, 0.84], [0, 0.27, 0], '#384942');
  for (const side of [-1, 1]) { box(root, [0.11, 0.23, 0.05], [side * 0.43, 0.12, 0.43], '#c4c6ac'); box(root, [0.05, 0.1, 0.24], [side * 0.22, 0.37, 0], '#2b3835'); }
  box(root, [0.49, 0.055, 0.08], [0, 0.43, 0], '#708176');
  box(root, [0.3, 0.2, 0.025], [0, 0, 0.415], '#d6d6a8'); return root;
}
export function createMuzzleFlash(weapon: WeaponId) {
  const surface = new THREE.MeshBasicMaterial({ map: muzzleTexture, color: '#fff4dc', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), surface);
  for (let index = 0; index < 2; index++) { const jet = new THREE.Mesh(new THREE.PlaneGeometry(0.65, 2.2).rotateX(Math.PI / 2).rotateZ(index * Math.PI / 2), surface); jet.position.z = -0.65; flash.add(jet); }
  flash.userData.size = flashSize(weapon); flash.scale.setScalar(flash.userData.size); flash.name = 'muzzle-flash'; return flash;
}

export class GameWorld {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(77, 1, 0.05, MAP_SIZE * 4 + 70);
  readonly viewScene = new THREE.Scene();
  readonly viewCamera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
  readonly viewmodel = new THREE.Group();
  readonly entities = new Map<string, THREE.Group>();
  private gun: THREE.Group;
  private arms: THREE.Object3D = makeArms();
  private flash: THREE.Mesh;
  private particles: Particle[] = [];
  private recoil = 0;
  private inspectAt = -100;
  private switchAt = -100;
  private currentWeapon: WeaponId = 'rifle';
  private currentSkin = 0;
  private currentKnifeStyle = 0;
  private appearanceKey = '';
  private weaponContext: 'view' | 'preview' = 'view';
  private shotAt = -100;
  private swingAt = -100;
  private swingCount = 0;
  private studio = false;
  private studioSpan = 1;
  private studioYaw = Math.PI / 2;
  private studioPitch = 0.12;
  private studioZoom = 1;
  private studioRotate = true;
  private studioInspectAt = -100;
  private retiring: THREE.Group | null = null;
  private thumbnails = new Map<string, string>();
  private supplyScene = new THREE.Scene();
  private supplyCamera = new THREE.PerspectiveCamera(40, 1, 0.01, 20);
  private supplyModel: THREE.Group | null = null;
  private supplyRadius = 1;
  private supplyYaw = 0.45;
  private supplyPitch = 0.12;
  private lobbyTime = 0;
  private currentFov = 77;
  private baseFov = 77;
  private bomb = new THREE.Group();
  private mapMesh: THREE.Group;
  private mapId: MapId;
  private sun = new THREE.DirectionalLight('#fff0d1', 3.4);
  private hemisphere = new THREE.HemisphereLight('#e1eff4', '#9b8058', 2.6);
  private environment: NonNullable<Snapshot['environment']> = { time: 'day', weather: 'clear' };
  private rain: THREE.LineSegments;
  private rainPositions = new Float32Array(260 * 6);
  private blast = new THREE.PointLight('#ffad5c', 0, 32, 2);
  private hitboxes = false;
  private quality: 'high' | 'medium' | 'low' | null = null;
  private reflection: THREE.Texture;
  private mapLoads = new Map<MapId, Promise<void>>();
  private thrown = new Map<string, THREE.Group>();
  private dropped = new Map<string, THREE.Group>();
  private resultsScene = new THREE.Scene();
  private resultsCamera = new THREE.PerspectiveCamera(48, 1, 0.05, 60);
  private resultsActors: THREE.Group[] = [];
  private resultsKey = '';
  private smokeVisuals = new Map<string, THREE.InstancedMesh>();
  private fireVisuals = new Map<string, THREE.InstancedMesh>();
  private hillVisual = new THREE.Mesh(new THREE.RingGeometry(0.95, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#e9c875', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  private freeForAll = false;
  private allyComposer: EffectComposer | null = null;
  private allyOutline: OutlinePass | null = null;
  private outlineTargets: THREE.Object3D[] = [];
  private viewerTeam: Player['team'] = 'CT';
  onAssetsChanged: () => void = () => {};

  constructor(container: HTMLElement, mapId: MapId = 'dustline') {
    this.mapId = mapId;
    let antialias = true;
    try { antialias = localStorage.getItem('bs-quality') !== 'low'; } catch {}
    this.renderer = new THREE.WebGLRenderer({ antialias, alpha: true, stencil: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.renderer.autoClear = false;
    const environmentGenerator = new THREE.PMREMGenerator(this.renderer); const room = new RoomEnvironment();
    const reflection = environmentGenerator.fromScene(room, 0.02).texture; this.reflection = reflection; room.dispose(); environmentGenerator.dispose();
    this.scene.environment = this.viewScene.environment = reflection; this.scene.environmentIntensity = 0.4; this.viewScene.environmentIntensity = 0.65;
    this.supplyScene.environment = reflection; this.supplyScene.background = new THREE.Color('#223c3b');
    this.supplyScene.add(new THREE.HemisphereLight('#e0f3ed', '#36433b', 3)); const supplyLight = new THREE.DirectionalLight('#fff1d1', 3); supplyLight.position.set(-2, 4, 3); this.supplyScene.add(supplyLight);
    this.resultsScene.background = new THREE.Color('#283b3b'); this.resultsScene.environment = reflection; this.resultsScene.environmentIntensity = 0.35;
    this.resultsScene.add(new THREE.HemisphereLight('#e3f1ec', '#37483c', 2.5));
    const resultLight = new THREE.DirectionalLight('#fff0d6', 3); resultLight.position.set(-3, 5, 4); this.resultsScene.add(resultLight);
    const resultFloor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: '#53635c', roughness: 0.94 })); resultFloor.rotation.x = -Math.PI / 2; this.resultsScene.add(resultFloor);
    this.renderer.domElement.id = 'game-canvas';
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.dataset.map = mapId;
    this.renderer.domElement.dataset.mapReady = String(!MAPS[mapId].imported);
    this.renderer.domElement.setAttribute('aria-label', 'Dustline 3D multiplayer arena');
    container.prepend(this.renderer.domElement);
    this.scene.background = new THREE.Color(MAPS[mapId].palette.sky);
    this.scene.fog = new THREE.Fog(MAPS[mapId].palette.sky, 50, 130);
    this.scene.add(this.hemisphere, this.blast);
    const hillFill = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#e9c875', transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide })); hillFill.position.y = -0.005; this.hillVisual.add(hillFill); this.hillVisual.visible = false; this.scene.add(this.hillVisual);
    const sun = this.sun;
    sun.position.set(-18, 32, 14); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -49, right: 49, top: 49, bottom: -49, near: 1, far: 130 });
    sun.shadow.normalBias = 0.035; sun.shadow.bias = -0.0001; sun.shadow.radius = 3;
    this.mapMesh = makeMap(mapId);
    this.scene.add(sun, this.mapMesh);
    this.viewScene.add(new THREE.HemisphereLight('#eef4f4', '#465852', 1.2));
    const light = new THREE.DirectionalLight('#fff0dc', 1.4); light.position.set(-2, 4, 1); this.viewScene.add(light);
    const fill = new THREE.DirectionalLight('#d8f4f2', 0.5); fill.position.set(2, 1, 3); this.viewScene.add(fill);
    const rim = new THREE.DirectionalLight('#ffffff', 0.65); rim.position.set(1, 3, -2); this.viewScene.add(rim);
    this.gun = makeWeapon('rifle', 0); this.viewmodel.add(this.gun, this.arms);
    this.flash = createMuzzleFlash('rifle');
    this.flash.position.set(0, 0.02, -0.85); this.flash.visible = false;
    this.viewmodel.add(this.flash); this.viewScene.add(this.viewmodel);
    box(this.bomb, [0.3, 0.16, 0.22], [0, 0.1, 0], '#3d4740');
    box(this.bomb, [0.1, 0.04, 0.1], [0, 0.2, 0], '#d6634b');
    for (let offset = 0; offset < this.rainPositions.length; offset += 6) { const x = Math.random() * 64 - 32; const y = Math.random() * 23; const z = Math.random() * 64 - 32; this.rainPositions.set([x, y, z, x + 0.1, y - 0.7, z], offset); }
    const rainGeometry = new THREE.BufferGeometry(); rainGeometry.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3)); this.rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: '#b9d7d6', transparent: true, opacity: 0.32, depthWrite: false })); this.rain.frustumCulled = false; this.rain.visible = false; this.scene.add(this.rain);
    this.bomb.visible = false; this.scene.add(this.bomb);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    assets.onReady = id => this.refreshAssets(id);
    void assets.initialize().then(() => Promise.all([assets.load('sas'), assets.load('sas-red'), assets.load('robot'), assets.load('m4a1s'), assets.prepareWeapon('pistol'), assets.prepareWeapon('rifle'), assets.load('karambit'), assets.load('c4')]));
  }

  private refreshAssets(id: string) {
    this.renderer.domElement.dataset.loadedAssets = [...new Set([...(this.renderer.domElement.dataset.loadedAssets || '').split(' ').filter(Boolean), id])].join(' ');
    if (id === 'sas' || id === 'sas-red' || id === 'm4a1s' || id === 'deagle-view' || id === 'knife-flip') {
      const hands = assets.viewArms(this.currentWeapon);
      if (hands) { this.viewmodel.remove(this.arms); disposeWeapon(this.arms); this.arms = hands; this.viewmodel.add(this.arms); }
    }
    if (id === 'sas' || id === 'sas-red' || id === 'robot') {
      for (const model of this.entities.values()) { this.scene.remove(model); (model.userData.characterMotion as CharacterMotion | undefined)?.dispose(); disposeWeapon(model); } this.entities.clear();
      if (this.resultsKey) this.clearResults();
    }
    if (id === 'c4') {
      const model = assets.instantiate('c4', 'prop', 0.3);
      if (model) { model.position.copy(this.bomb.position); model.visible = this.bomb.visible; this.scene.remove(this.bomb); disposeWeapon(this.bomb); this.bomb = model; this.scene.add(this.bomb); }
    }
    const currentAppearance = this.appearanceKey && this.appearanceKey !== '@refresh' ? JSON.parse(this.appearanceKey) as SkinAppearance : undefined;
    if (id === (currentAppearance && SKIN_BY_ID.get(currentAppearance.skinId)?.asset || assets.weaponAsset(this.currentWeapon, this.studio ? 'preview' : 'view')) || id === 'deagle-view' && this.currentWeapon === 'handCannon') {
      const appearance: SkinAppearance | undefined = this.appearanceKey && this.appearanceKey !== '@refresh' ? JSON.parse(this.appearanceKey) : undefined;
      const studio = this.studio; this.appearanceKey = '@refresh';
      if (studio && appearance) this.setStudio(appearance); else this.setWeapon(this.currentWeapon, this.currentSkin, performance.now() / 1000, this.currentKnifeStyle, appearance);
    }
    this.entities.forEach(model => { model.userData.weaponKey = ''; });
    this.onAssetsChanged();
  }

  resize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (this.allyComposer) { this.allyComposer.setPixelRatio(Math.min(this.renderer.getPixelRatio(), 1.25)); this.allyComposer.setSize(window.innerWidth, window.innerHeight); }
    this.camera.aspect = this.viewCamera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix(); this.viewCamera.updateProjectionMatrix();
  }

  setMap(mapId: MapId) {
    if (mapId === this.mapId && (!MAPS[mapId].imported || this.mapMesh.userData.assetId === MAPS[mapId].imported.assetId)) return;
    this.scene.remove(this.mapMesh); disposeWeapon(this.mapMesh);
    this.mapId = mapId; this.mapMesh = makeMap(mapId);
    this.scene.background = new THREE.Color(MAPS[mapId].palette.sky);
    this.scene.fog = new THREE.Fog(MAPS[mapId].palette.sky, 50, 130);
    this.scene.add(this.mapMesh);
    this.renderer.domElement.dataset.map = mapId; this.renderer.domElement.dataset.mapReady = String(!MAPS[mapId].imported || !!this.mapMesh.userData.assetId);
    this.renderer.domElement.setAttribute('aria-label', `${MAPS[mapId].name} 3D multiplayer arena`);
  }

  prepareMap(mapId: MapId): Promise<void> {
    const metadata = MAPS[mapId].imported; if (!metadata) return Promise.resolve();
    const pending = this.mapLoads.get(mapId); if (pending) return pending;
    const task = Promise.all([
      assets.load(metadata.assetId).then(loaded => { if (!loaded) throw new Error(`${metadata.name}: level model could not load.`); }),
      mapGeometry(mapId) ? Promise.resolve() : fetch(`/models/imported/${metadata.assetId}.collision.bin`).then(async response => {
        if (!response.ok) throw new Error(`${metadata.name}: collision data could not load.`);
        registerMapGeometry(mapId, await response.arrayBuffer());
      }),
    ]).then(() => {}).catch(error => { this.mapLoads.delete(mapId); throw error; });
    this.mapLoads.set(mapId, task); return task;
  }

  setFov(value: number) {
    this.baseFov = THREE.MathUtils.clamp(value, 65, 105);
  }

  setMatch(snapshot: Snapshot) {
    this.environment = snapshot.environment || { time: 'day', weather: 'clear' };
    this.mapMesh.traverse(object => { if (object.userData.bombSite) object.visible = isBombRound(snapshot); });
    this.freeForAll = snapshot.mode === 'gungame'; this.hillVisual.visible = !!snapshot.hill && !snapshot.matchComplete;
    if (snapshot.hill) { const hill = snapshot.hill; this.hillVisual.position.set(hill.position.x, hill.position.y + 0.03, hill.position.z); this.hillVisual.scale.set(hill.radius, 1, hill.radius); const color = hill.contested ? '#eee3c3' : hill.owner === 'CT' ? '#71bde4' : hill.owner === 'T' ? '#e38a78' : '#e9c875'; this.hillVisual.traverse(object => { if (object instanceof THREE.Mesh) (object.material as THREE.MeshBasicMaterial).color.set(color); }); }
    const smokeIds = new Set<string>();
    for (const cloud of snapshot.smokes || []) {
      smokeIds.add(cloud.id); let mesh = this.smokeVisuals.get(cloud.id);
      if (!mesh) { mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.85, 1), new THREE.MeshStandardMaterial({ color: '#a7afa4', roughness: 1, transparent: true, opacity: 0.93, depthWrite: false }), cloud.cells.length); mesh.frustumCulled = false; this.smokeVisuals.set(cloud.id, mesh); this.scene.add(mesh); }
      for (const [index, cell] of cloud.cells.entries()) mesh.setMatrixAt(index, new THREE.Matrix4().compose(new THREE.Vector3(cell.x, cell.y, cell.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(index * 0.7, index * 0.4, 0)), new THREE.Vector3().setScalar(smokeCellVisible(cloud, cell, snapshot.time) ? 1.15 : 0)));
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const [id, mesh] of this.smokeVisuals) if (!smokeIds.has(id)) { mesh.removeFromParent(); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); mesh.dispose(); this.smokeVisuals.delete(id); }
    const fireIds = new Set<string>();
    for (const fire of snapshot.fires || []) {
      fireIds.add(fire.id); let mesh = this.fireVisuals.get(fire.id);
      if (!mesh) { mesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.6, 1.05, 7), new THREE.MeshBasicMaterial({ color: '#f6ad55', transparent: true, opacity: 0.82, depthWrite: false }), fire.cells.length); mesh.frustumCulled = false; this.fireVisuals.set(fire.id, mesh); this.scene.add(mesh); }
      for (const [index, cell] of fire.cells.entries()) mesh.setMatrixAt(index, new THREE.Matrix4().compose(new THREE.Vector3(cell.x, cell.y + 0.35, cell.z), new THREE.Quaternion(), new THREE.Vector3(1, 0.7 + Math.sin(snapshot.time / 80 + index) * 0.3, 1)));
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const [id, mesh] of this.fireVisuals) if (!fireIds.has(id)) { mesh.removeFromParent(); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); mesh.dispose(); this.fireVisuals.delete(id); }
    if (snapshot.matchWinner || snapshot.matchComplete) {
      const key = `${snapshot.code}:${snapshot.round}:${snapshot.winnerId || snapshot.matchWinner || 'draw'}`;
      if (key !== this.resultsKey) {
        this.clearResults(); this.resultsKey = key;
        for (const entry of matchLineup(snapshot.players, snapshot.mode === 'gungame' || snapshot.matchDraw ? undefined : snapshot.matchWinner, snapshot.winnerId)) {
          const model = character(entry.player.team, entry.player.skin); model.position.set(entry.x, 0, entry.z); model.rotation.y = Math.PI;
          const held = buildWeapon(entry.player.weapon, entry.player.cosmetics[entry.player.weapon], 0, undefined, 'world'); held.position.set(0.18, 1.01, -0.4); held.scale.setScalar(0.8); model.add(held);
          this.resultsActors.push(model); this.resultsScene.add(model);
        }
      }
    } else if (this.resultsKey) this.clearResults();
    const dropped = new Set<string>();
    for (const drop of snapshot.drops || []) {
      dropped.add(drop.id);
      if (!this.dropped.has(drop.id)) {
        const model = drop.appearance ? buildWeapon(drop.weapon, drop.appearance, 0, undefined, 'world') : makeWeapon(drop.weapon, 0, 0, 'world');
        model.position.set(drop.x, drop.y, drop.z); model.rotation.z = drop.roll ?? Math.PI / 2; model.rotation.y = drop.yaw ?? drop.id.length % 6;
        this.dropped.set(drop.id, model); this.scene.add(model);
      }
      const model = this.dropped.get(drop.id)!; model.position.set(drop.x, drop.y, drop.z); model.rotation.z = drop.roll ?? Math.PI / 2; model.rotation.y = drop.yaw ?? 0;
    }
    for (const [id, model] of this.dropped) if (!dropped.has(id)) { this.scene.remove(model); disposeWeapon(model); this.dropped.delete(id); }
    const present = new Set<string>();
    for (const projectile of snapshot.projectiles || []) {
      present.add(projectile.id); let model = this.thrown.get(projectile.id);
      if (model && !model.userData.assetId && assets.has(projectile.kind)) { this.scene.remove(model); disposeWeapon(model); this.thrown.delete(projectile.id); model = undefined; }
      if (!model) {
        model = assets.instantiate(projectile.kind, 'prop', 0.14) || new THREE.Group().add(new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), new THREE.MeshStandardMaterial({ color: projectile.kind === 'grenade' ? '#6a8053' : '#bfc8cf', roughness: 0.6 })));
        if (!assets.has(projectile.kind)) void assets.load(projectile.kind);
        model.position.set(projectile.x, projectile.y, projectile.z); this.thrown.set(projectile.id, model); this.scene.add(model);
      }
      model.userData.target = new THREE.Vector3(projectile.x, projectile.y, projectile.z);
    }
    for (const [id, model] of this.thrown) if (!present.has(id)) { this.scene.remove(model); disposeWeapon(model); this.thrown.delete(id); }
  }
  private clearResults() {
    for (const model of this.resultsActors) { this.resultsScene.remove(model); (model.userData.characterMotion as CharacterMotion | undefined)?.dispose(); disposeWeapon(model); }
    this.resultsActors = []; this.resultsKey = ''; delete this.renderer.domElement.dataset.resultLineup;
  }
  setHitboxes(visible: boolean) { this.hitboxes = visible; }

  setQuality(level: 'high' | 'medium' | 'low') {
    if (this.quality === level) return;
    this.quality = level; this.scene.environment = level === 'high' ? this.reflection : null; this.viewScene.environment = this.reflection;
    const pixelRatio = level === 'high' ? 1.5 : level === 'medium' ? 1.2 : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatio));
    this.renderer.shadowMap.enabled = level === 'high';
    this.scene.traverse(object => {
      if (object instanceof THREE.DirectionalLight && object.castShadow) {
        object.shadow.mapSize.setScalar(level === 'high' ? 2048 : level === 'medium' ? 1024 : 512);
        object.shadow.needsUpdate = true;
      }
    });
    this.resize();
  }

  setWeapon(id: WeaponId, skin: number, now: number, knifeStyle = 0, appearance?: SkinAppearance) {
    const key = appearance ? JSON.stringify(appearance) : '';
    const context = this.studio ? 'preview' : 'view';
    if (id === this.currentWeapon && skin === this.currentSkin && knifeStyle === this.currentKnifeStyle && key === this.appearanceKey && context === this.weaponContext) return;
    if (this.retiring) { this.viewmodel.remove(this.retiring); disposeWeapon(this.retiring); }
    this.retiring = this.gun;
    this.gun = appearance ? buildWeapon(id, appearance, knifeStyle, undefined, context) : makeWeapon(id, skin, knifeStyle, context); this.viewmodel.add(this.gun);
    this.currentWeapon = id; this.currentSkin = skin; this.currentKnifeStyle = knifeStyle; this.switchAt = now;
    if (!this.studio) {
      const grip = id === 'knife' ? 'knife' : WEAPONS[id].model === 'pistol' ? 'pistol' : 'rifle';
      if (grip === 'pistol' && !assets.has('deagle-view')) void assets.load('deagle-view');
      if (grip === 'knife' && !assets.has('knife-flip')) void assets.load('knife-flip');
      if (this.arms.userData.weaponGrip !== grip) { const hands = assets.viewArms(id); if (hands) { this.viewmodel.remove(this.arms); disposeWeapon(this.arms); this.arms = hands; this.viewmodel.add(hands); } }
    }
    this.appearanceKey = key;
    this.weaponContext = context;
    this.renderer.domElement.dataset.weaponAsset = this.gun.userData.assetId || 'procedural'; this.renderer.domElement.dataset.weaponContext = context;
    this.flash.position.z = this.gun.userData.muzzle || -0.7;
    this.flash.userData.size = flashSize(id);
  }

  inspect(now: number) { this.inspectAt = now; }
  kick() { if (this.currentWeapon === 'knife') return; this.shotAt = performance.now() / 1000; this.switchAt = Math.min(this.switchAt, this.shotAt - (this.gun.userData.drawDuration || 0.5)); this.recoil = Math.min(this.recoil + (WEAPONS[this.currentWeapon].model === 'sniper' ? 0.15 : 0.08), 0.22); }

  melee(id: string, local: boolean) {
    const now = performance.now() / 1000;
    if (local) { this.swingAt = now; this.swingCount++; this.inspectAt = -100; this.recoil = 0; }
    else { const model = this.entities.get(id); if (model) { model.userData.swingAt = now; model.userData.swingCount = (model.userData.swingCount || 0) + 1; } }
  }

  setStudio(appearance: SkinAppearance | null) {
    this.studio = !!appearance;
    this.gun.position.set(0, 0, 0);
    this.studioYaw = Math.PI / 2; this.studioPitch = 0.12; this.studioZoom = 1; this.studioRotate = true; this.studioInspectAt = -100;
    if (appearance) {
      const skin = SKIN_BY_ID.get(appearance.skinId)!;
      this.setWeapon(skin.weapon, 0, performance.now() / 1000, 0, appearance);
      if (this.retiring) { this.viewmodel.remove(this.retiring); disposeWeapon(this.retiring); this.retiring = null; }
      this.gun.removeFromParent(); this.gun.position.set(0, 0, 0);
      const bounds = modelBounds(this.gun, true); const size = bounds.getSize(new THREE.Vector3());
      this.studioSpan = Math.max(size.x, size.y, size.z, 0.1); this.gun.position.sub(bounds.getCenter(new THREE.Vector3()));
      this.viewmodel.add(this.gun); this.gun.visible = true; this.switchAt = performance.now() / 1000 - 1;
      if (skin.knife === 'karambit') this.studioPitch = 0.95;
      this.inspect(performance.now() / 1000);
    } else this.setWeapon(this.currentWeapon, this.currentSkin, performance.now() / 1000, this.currentKnifeStyle, this.appearanceKey && this.appearanceKey !== '@refresh' ? JSON.parse(this.appearanceKey) : undefined);
  }

  rotateStudio(horizontal: number, vertical: number) { this.studioYaw += horizontal * 0.009; this.studioPitch = THREE.MathUtils.clamp(this.studioPitch + vertical * 0.007, -1.2, 1.2); this.studioRotate = false; }
  zoomStudio(amount: number) { this.studioZoom = THREE.MathUtils.clamp(this.studioZoom + amount, 0.6, 1.4); }
  toggleStudioRotation() { this.studioRotate = !this.studioRotate; return this.studioRotate; }
  playStudioInspect() { this.studioInspectAt = performance.now() / 1000; }

  showSupplyCase(color: string, charm = false) {
    this.hideSupplyCase(); this.supplyYaw = 0.45; this.supplyPitch = 0.12;
    const asset = charm ? 'dream-case' : 'case';
    this.supplyModel = assets.instantiate(asset, 'prop', 1.3) || supplyCaseModel(color);
    this.supplyModel.rotation.set(0, 0, 0); const bounds = modelBounds(this.supplyModel); this.supplyModel.position.sub(bounds.getCenter(new THREE.Vector3()));
    this.supplyRadius = bounds.getSize(new THREE.Vector3()).length() / 2;
    this.supplyScene.add(this.supplyModel); this.renderer.domElement.dataset.supplyModel = this.supplyModel.userData.assetId || 'original-case';
    const model = this.supplyModel;
    void assets.load(asset).then(loaded => { if (loaded && this.supplyModel === model && model.userData.assetId !== asset) this.showSupplyCase(color, charm); });
  }
  hideSupplyCase() { if (this.supplyModel) { this.supplyModel.removeFromParent(); disposeWeapon(this.supplyModel); this.supplyModel = null; } delete this.renderer.domElement.dataset.supplyModel; }
  rotateSupplyCase(horizontal: number, vertical: number) { this.supplyYaw += horizontal * 0.01; this.supplyPitch = THREE.MathUtils.clamp(this.supplyPitch + vertical * 0.008, -0.6, 0.6); }
  charmThumbnail(charm: CharmId) { return this.modelThumbnail(`charm:${charm}`, () => charmPendant(CHARM_BY_ID.get(charm)!)); }
  caseThumbnail(color: string) { return this.modelThumbnail(`case:${color}`, () => supplyCaseModel(color)); }

  thumbnail(id: WeaponId, appearance?: SkinAppearance) {
    const asset = appearance && SKIN_BY_ID.get(appearance.skinId)?.asset || assets.weaponAsset(id, 'preview'); const key = `${asset}:${assets.has(asset)}:${id}:${JSON.stringify(appearance)}`;
    return this.modelThumbnail(key, () => buildWeapon(id, appearance));
  }
  private modelThumbnail(key: string, build: () => THREE.Group) {
    if (this.thumbnails.has(key)) return this.thumbnails.get(key)!;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#4d625f');
    scene.environment = this.reflection; scene.environmentIntensity = 0.9;
    scene.add(new THREE.HemisphereLight('#e0f2f4', '#59635a', 3));
    const keyLight = new THREE.DirectionalLight('#fff0d5', 4); keyLight.position.set(2, 3, 1); scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight('#d3e9e7', 2); fillLight.position.set(-2, 1, -1); scene.add(fillLight);
    const model = build(); scene.add(model);
    const bounds = modelBounds(model, true); const center = bounds.getCenter(new THREE.Vector3());
    model.position.sub(center);
    const size = bounds.getSize(new THREE.Vector3()); const span = Math.max(size.x, size.z, size.y * 2.2, 0.04) * 0.62;
    const camera = new THREE.OrthographicCamera(-span, span, span / 2, -span / 2, 0.01, 10);
    camera.position.set(2.6, 0.85, 0.9); camera.lookAt(0, 0, 0);
    const target = new THREE.WebGLRenderTarget(256, 128); const previous = this.renderer.getRenderTarget();
    const exposure = this.renderer.toneMappingExposure;
    this.renderer.toneMappingExposure = 1.8;
    try { this.renderer.setRenderTarget(target); this.renderer.clear(); this.renderer.render(scene, camera); }
    finally { this.renderer.toneMappingExposure = exposure; }
    const pixels = new Uint8Array(256 * 128 * 4); this.renderer.readRenderTargetPixels(target, 0, 0, 256, 128, pixels);
    this.renderer.setRenderTarget(previous);
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
    const context = canvas.getContext('2d')!; const image = context.createImageData(256, 128);
    for (let row = 0; row < 128; row++) image.data.set(pixels.subarray((127 - row) * 1024, (128 - row) * 1024), row * 1024);
    context.putImageData(image, 0, 0); const url = canvas.toDataURL('image/webp');
    target.dispose(); disposeWeapon(model);
    this.thumbnails.set(key, url);
    if (this.thumbnails.size > 96) this.thumbnails.delete(this.thumbnails.keys().next().value!);
    return url;
  }

  shot(origin: Vec, point: Vec, local: boolean, weapon: WeaponId, effects = true) {
    if (weapon === 'knife') return;
    const socket = local ? this.gun.getObjectByName('muzzle-socket') : undefined;
    const viewPoint = socket?.getWorldPosition(new THREE.Vector3());
    const start = local && viewPoint ? new THREE.Vector3(viewPoint.clone().project(this.viewCamera).x, viewPoint.clone().project(this.viewCamera).y, 0.5).unproject(this.camera).sub(this.camera.position).normalize().multiplyScalar(viewPoint.length()).add(this.camera.position) : new THREE.Vector3(origin.x, origin.y, origin.z);
    const end = new THREE.Vector3(point.x, point.y, point.z);
    if (!local && effects) { const muzzle = createMuzzleFlash(weapon); muzzle.position.copy(start); muzzle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), end.clone().sub(start).normalize()); this.scene.add(muzzle); this.particles.push({ mesh: muzzle, velocity: new THREE.Vector3(), life: 0.065, max: 0.065, kind: 'flash' }); }
    const length = start.distanceTo(end);
    const tracer = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, Math.min(length, 90), 4), tracerMaterial);
    tracer.position.copy(start).lerp(end, 0.5); tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
    this.scene.add(tracer); this.particles.push({ mesh: tracer, velocity: new THREE.Vector3(), life: 0.055, max: 0.055, kind: 'tracer' });
    for (let index = 0; index < 5; index++) {
      const mesh = new THREE.Mesh(sparkGeometry, sparkMaterial); mesh.position.copy(end); this.scene.add(mesh);
      this.particles.push({ mesh, velocity: new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2), life: 0.3, max: 0.3, kind: 'spark' });
    }
    if (local && effects) {
      const shell = new THREE.Mesh(shellGeometry, shellMaterial);
      shell.position.copy(this.camera.position).add(new THREE.Vector3(0.18, -0.16, -0.3).applyQuaternion(this.camera.quaternion));
      this.scene.add(shell);
      const velocity = new THREE.Vector3(1.6, 1.8, 0).applyQuaternion(this.camera.quaternion);
      this.particles.push({ mesh: shell, velocity, life: 1.4, max: 1.4, kind: 'shell' });
    }
    const impact = new THREE.Mesh(new THREE.CircleGeometry(0.035 + Math.random() * 0.025, 6), decalMaterial);
    impact.position.copy(end).addScaledVector(end.clone().sub(start).normalize(), -0.015);
    impact.lookAt(start); this.scene.add(impact);
    this.particles.push({ mesh: impact, velocity: new THREE.Vector3(), life: 14, max: 14, kind: 'decal' });
    while (this.particles.length > 160) this.removeParticle(this.particles.shift()!);
  }

  explode(position: Vec) {
    this.blast.color.set('#ffad5c'); this.blast.position.set(position.x, position.y + 0.6, position.z); this.blast.intensity = 100;
    for (let index = 0; index < 80; index++) {
      const mesh = new THREE.Mesh(sparkGeometry, index % 3 ? sparkMaterial : shellMaterial);
      mesh.position.set(position.x, position.y + 0.2, position.z); mesh.scale.setScalar(2 + Math.random() * 4); this.scene.add(mesh);
      this.particles.push({ mesh, velocity: new THREE.Vector3((Math.random() - 0.5) * 20, Math.random() * 14, (Math.random() - 0.5) * 20), life: 1.5, max: 1.5, kind: 'spark' });
    }
    for (let index = 0; index < 10; index++) {
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4 + Math.random() * 0.7, 0), new THREE.MeshBasicMaterial({ color: index < 3 ? '#eeab65' : '#5b635a', transparent: true, opacity: 0.55, depthWrite: false })); mesh.position.set(position.x, position.y + 0.3, position.z); this.scene.add(mesh);
      this.particles.push({ mesh, velocity: new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 2, (Math.random() - 0.5) * 5), life: 1.7, max: 1.7, kind: 'smoke' });
    }
    while (this.particles.length > 180) this.removeParticle(this.particles.shift()!);
  }

  flashbang(position: Vec) { this.blast.color.set('#fffef4'); this.blast.position.set(position.x, position.y + 0.3, position.z); this.blast.intensity = 75; }
  clearImpacts() {
    this.particles = this.particles.filter(particle => { if (particle.kind !== 'decal') return true; this.removeParticle(particle); return false; });
  }

  private removeParticle(particle: Particle) {
    this.scene.remove(particle.mesh);
    if (particle.kind === 'flash') { particle.mesh.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); }); (particle.mesh.material as THREE.Material).dispose(); }
    if (particle.kind === 'decal' || particle.kind === 'tracer' || particle.kind === 'smoke') particle.mesh.geometry.dispose();
    if (particle.kind === 'smoke') (particle.mesh.material as THREE.Material).dispose();
  }

  updatePlayers(players: Player[], ownId: string, dt: number, time: number) {
    const present = new Set<string>();
    const viewer = players.find(player => player.id === ownId);
    this.outlineTargets = []; if (viewer) this.viewerTeam = viewer.team;
    for (const player of players) {
      if (player.id === ownId) continue;
      present.add(player.id);
      let model = this.entities.get(player.id);
      if (!model) { model = character(player.team, player.skin); this.entities.set(player.id, model); this.scene.add(model); }
      setTeamOutline(model, player.team, viewer?.team, !this.freeForAll && !!viewer && allyBehindCover(viewer, player, this.mapId));
      const movement = Math.hypot(model.position.x - player.x, model.position.z - player.z) > 0.015;
      if (player.hp <= 0 && !model.userData.deadAt) model.userData.deadAt = time;
      if (player.hp > 0) model.userData.deadAt = 0;
      const fall = player.hp <= 0 ? Math.min(1, (time - model.userData.deadAt) / 0.65) : 0;
      model.visible = player.hp > 0 || time - model.userData.deadAt < 2.4;
      model.position.set(player.x, player.y, player.z); model.rotation.y = player.yaw;
      model.rotation.x = fall * 1.4; model.position.y -= fall * 0.15;
      if (model.userData.outlineSelected && player.hp > 0) this.outlineTargets.push(...model.children.filter(child => child.name !== 'heldWeapon' && child.name !== 'hitboxes'));
      const motion = model.userData.characterMotion as CharacterMotion | undefined;
      if (motion) { motion.update(dt, time, movement ? player.crouch ? 2.3 : 4.8 : 0, player.crouch, !!player.reloading, player.pitch, player.hp <= 0); }
      else {
        model.scale.y = THREE.MathUtils.damp(model.scale.y, player.crouch ? 0.66 : 1, 15, dt);
        const legs = model.userData.legs as THREE.Object3D[];
        legs.forEach((leg, index) => { leg.rotation.x = (movement && !fall ? Math.sin(time * 10 + index * Math.PI) * 0.5 : 0) + (player.crouch ? 0.55 : 0); });
        const arms = model.userData.arms as THREE.Group[];
        arms.forEach((arm, index) => { arm.rotation.x = -player.pitch * 0.5 + (player.reloading && !index ? Math.sin(time * 7) * 0.65 : movement ? Math.sin(time * 10 + index * Math.PI) * 0.1 : 0); arm.rotation.z = fall * (index ? 0.8 : -0.8); });
      }
      const key = `${player.weapon}:${player.skin}:${JSON.stringify(player.cosmetics[player.weapon] || null)}`;
      if (model.userData.weaponKey !== key) {
        const previous = model.getObjectByName('heldWeapon'); if (previous) { model.remove(previous); disposeWeapon(previous); }
        const held = player.cosmetics[player.weapon] ? buildWeapon(player.weapon, player.cosmetics[player.weapon], 0, undefined, 'world') : makeWeapon(player.weapon, player.skin, 0, 'world'); held.name = 'heldWeapon'; held.position.set(0.18, 1.01, -0.4); held.scale.setScalar(0.8); model.add(held); model.userData.weaponKey = key;
      }
      const held = model.getObjectByName('heldWeapon') as THREE.Group;
      const swing = meleePose(time - (model.userData.swingAt ?? -100), model.userData.swingCount || 0);
      held.rotation.set(player.pitch + swing.pitch, swing.yaw, swing.roll);
      animateWeapon(held, { time, reload: player.reloading ? 0.5 + Math.sin(time * 5) * 0.3 : 0, inspect: -1, shotAge: 1, swingAge: player.weapon === 'knife' ? time - (model.userData.swingAt ?? -100) : undefined, attack: model.userData.swingCount || 0 });
      let debug = model.getObjectByName('hitboxes');
      if (this.hitboxes && !debug) { debug = new THREE.Group(); debug.name = 'hitboxes'; for (const [width, height, depth, y] of [[0.36, 0.36, 0.36, 1.58], [0.58, 0.56, 0.42, 1.12], [0.57, 0.7, 0.42, 0.41]]) { const helper = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, depth)), new THREE.LineBasicMaterial({ color: y > 1.5 ? '#ff836b' : '#83dfba', depthTest: false })); helper.position.y = y; debug.add(helper); } model.add(debug); }
      if (debug) debug.visible = this.hitboxes && player.hp > 0;
    }
    for (const [id, model] of this.entities) if (!present.has(id)) {
      this.scene.remove(model); (model.userData.characterMotion as CharacterMotion | undefined)?.dispose(); disposeWeapon(model); this.entities.delete(id);
    }
  }

  update(dt: number, time: number, player: Player | null, aim: { yaw: number; pitch: number }, state: {
    lobby: boolean; scope: boolean; moving: boolean; reloading: number; flash: number; error: Vec; bomb: Vec | null; sprint?: boolean;
  }) {
    if (this.supplyModel) {
      const stage = document.getElementById('case-preview-stage')!.getBoundingClientRect();
      this.supplyYaw += dt * 0.2; this.supplyModel.rotation.set(this.supplyPitch, this.supplyYaw, 0);
      this.supplyCamera.aspect = stage.width / Math.max(1, stage.height);
      const vertical = this.supplyCamera.fov * Math.PI / 360; const horizontal = Math.atan(Math.tan(vertical) * this.supplyCamera.aspect);
      const distance = this.supplyRadius * 1.15 / Math.sin(Math.min(vertical, horizontal));
      this.supplyCamera.position.set(0, distance * 0.12, distance); this.supplyCamera.lookAt(0, 0, 0); this.supplyCamera.updateProjectionMatrix();
      this.renderer.setClearColor('#223c3b', 1); this.renderer.clear(); this.renderer.setViewport(stage.left, window.innerHeight - stage.bottom, stage.width, stage.height); this.renderer.setScissor(stage.left, window.innerHeight - stage.bottom, stage.width, stage.height); this.renderer.setScissorTest(true); this.renderer.render(this.supplyScene, this.supplyCamera); this.renderer.setScissorTest(false); this.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight); return;
    }
    if (this.resultsKey) {
      this.resultsCamera.aspect = this.camera.aspect;
      this.resultsCamera.position.set(0, 1.65, Math.max(6.5, 3.5 / Math.tan(this.resultsCamera.fov / 360 * Math.PI) / this.resultsCamera.aspect));
      this.resultsCamera.lookAt(0, 0.95, -0.5); this.resultsCamera.updateProjectionMatrix();
      for (const actor of this.resultsActors) (actor.userData.characterMotion as CharacterMotion | undefined)?.update(dt, time, 0, false, false, 0, false);
      this.renderer.clear(); this.renderer.render(this.resultsScene, this.resultsCamera); this.renderer.domElement.dataset.resultLineup = String(this.resultsActors.length); return;
    }
    this.lobbyTime += dt;
    const themes = { day: ['#cbd9d6', '#fff0d1', 3.4, 2.6, 330], dusk: ['#c7b7b1', '#ffd1a0', 2, 2, 280], night: ['#2b4144', '#b6d0d6', 1, 1.45, 210], dawn: ['#bfcfc9', '#f2d5b0', 1.8, 2.2, 260] } as const;
    const theme = themes[this.environment.time]; const blend = Math.min(1, dt * 1.2); const fog = this.scene.fog as THREE.Fog;
    (this.scene.background as THREE.Color).lerp(new THREE.Color(theme[0]), blend); fog.color.copy(this.scene.background as THREE.Color);
    fog.near = THREE.MathUtils.lerp(fog.near, this.environment.weather === 'fog' ? 12 : 42, blend); fog.far = THREE.MathUtils.lerp(fog.far, this.environment.weather === 'fog' ? 65 : theme[4], blend);
    this.sun.color.lerp(new THREE.Color(theme[1]), blend); this.sun.intensity = THREE.MathUtils.lerp(this.sun.intensity, theme[2] * (this.environment.weather === 'overcast' ? 0.68 : 1), blend); this.hemisphere.intensity = THREE.MathUtils.lerp(this.hemisphere.intensity, theme[3], blend);
    const focus = new THREE.Vector3(player?.x || 0, 0, player?.z || 0); this.sun.target.position.lerp(focus, Math.min(1, dt * 5)); this.sun.target.updateMatrixWorld();
    this.sun.position.lerp(focus.add(new THREE.Vector3(this.environment.time === 'day' ? -23 : 38, this.environment.time === 'night' ? 38 : this.environment.time === 'day' ? 42 : 12, 17)), blend);
    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(this.renderer.toneMappingExposure, this.environment.time === 'night' ? 1.65 : 1.22, blend);
    this.mapMesh.traverse(object => { if (object instanceof THREE.Mesh) for (const surface of [object.material].flat() as THREE.MeshStandardMaterial[]) {
      if (!('roughness' in surface)) continue;
      surface.userData.dryRoughness ??= surface.roughness;
      surface.roughness = THREE.MathUtils.lerp(surface.roughness, this.environment.weather === 'rain' ? 0.28 : surface.userData.dryRoughness, blend);
    } });
    this.rain.visible = this.environment.weather === 'rain';
    if (this.rain.visible) { this.rain.position.set(player?.x || 0, 0, player?.z || 0); for (let offset = 0; offset < this.rainPositions.length; offset += 6) { const y = (this.rainPositions[offset + 1] - dt * 16 + 23) % 23; this.rainPositions[offset + 1] = y; this.rainPositions[offset + 4] = y - 0.7; } this.rain.geometry.getAttribute('position').needsUpdate = true; }
    this.blast.intensity = Math.max(0, this.blast.intensity - dt * 170);
    for (const model of this.thrown.values()) { model.position.lerp(model.userData.target, Math.min(1, dt * 24)); model.rotation.x += dt * 4; model.rotation.z += dt * 2; }
    if (state.lobby) {
      const orbit = Math.sin(this.lobbyTime * 0.06) * 2;
      const focus = this.mapMesh.userData.focus as THREE.Vector3 | undefined;
      if (focus) { const span = this.mapMesh.userData.span as number; this.camera.position.copy(focus).add(new THREE.Vector3(span * 0.45 + orbit, span * 0.55, span * 0.55)); this.camera.lookAt(focus); }
      else { this.camera.position.set(52 + orbit, 30, 72); this.camera.lookAt(-22, 0, -30); }
    } else if (player) {
      this.camera.position.set(player.x + state.error.x, player.y + eyeHeight(player.crouch) + state.error.y, player.z + state.error.z);
      this.camera.rotation.order = 'YXZ'; this.camera.rotation.set(aim.pitch, aim.yaw, 0);
    }
    this.renderer.domElement.dataset.viewMode = state.lobby ? 'lobby' : 'match';
    this.renderer.domElement.dataset.playerAlive = String(!!player && player.hp > 0);
    this.currentFov = THREE.MathUtils.damp(this.currentFov, state.scope ? scopedFov(this.currentWeapon, this.baseFov) : this.baseFov, 16, dt);
    this.renderer.domElement.dataset.scopeFov = String(this.currentFov.toFixed(2));
    this.camera.fov = this.currentFov; this.camera.updateProjectionMatrix();
    const inspectTime = time - this.inspectAt;
    const inspecting = inspectTime >= 0 && inspectTime < 3.4;
    const inspect = inspecting ? Math.sin(Math.min(1, inspectTime / 0.65) * Math.PI / 2) * Math.sin(Math.min(1, (3.4 - inspectTime) / 0.65) * Math.PI / 2) : 0;
    const knifeInspect = this.currentWeapon === 'knife' ? inspect : 0;
    const knifeFlip = knifeInspect * Math.sin(inspectTime * 2.6) * 0.12;
    const reloadProgress = state.reloading > 0 ? Math.max(0.001, 1 - state.reloading * 1000 / Math.max(1, WEAPONS[this.currentWeapon].reload)) : 0;
    const authored = this.gun.userData.animation as ModelAnimation | undefined;
    const reload = reloadProgress && !authored?.has('reload') ? Math.sin(reloadProgress * Math.PI) : 0;
    const switchDrop = Math.max(0, 1 - (time - this.switchAt) / 0.3);
    const idle = Math.sin(time * 1.6) * 0.004;
    const bob = state.moving ? Math.sin(time * 10) * 0.009 : idle;
    this.viewmodel.position.set((state.lobby ? 0.43 : 0.25) - inspect * (this.currentWeapon === 'knife' ? 0.32 : 0.17), -0.22 + bob + inspect * (this.currentWeapon === 'knife' ? 0.18 : 0.04) - reload * 0.23 - switchDrop * 0.3, -0.53 + this.recoil + inspect * 0.04);
    this.viewmodel.rotation.set(this.recoil * 0.65 + reload * 0.4 - inspect * 0.1 + knifeFlip * 0.8, -0.1 + inspect * (0.65 + Math.sin(inspectTime * 2.2) * 0.8) + knifeInspect * Math.sin(inspectTime * 3.3) * 0.6, inspect * (-0.65 - Math.sin(inspectTime * 1.8) * 0.3) + reload * -0.7 + knifeFlip * 1.1);
    if (this.currentWeapon === 'knife' && !this.studio) {
      const pose = knifeHoldPose(inspecting ? inspectTime : -1, time - this.swingAt, this.swingCount);
      this.viewmodel.position.set(pose.x, pose.y + bob - switchDrop * 0.3, pose.z); this.viewmodel.rotation.set(pose.pitch, pose.yaw, pose.roll);
    }
    this.viewmodel.scale.setScalar(state.lobby ? 1.25 : 1);
    this.arms.visible = !state.lobby && !this.gun.userData.hasHands;
    (this.arms.userData.characterMotion as CharacterMotion | undefined)?.update(dt, time, 0, false, state.reloading > 0, 0, false, this.currentWeapon);
    this.viewmodel.visible = !state.scope;
    if (this.studio) {
      this.viewmodel.visible = true; this.arms.visible = false;
      if (this.studioRotate) this.studioYaw += dt * 0.26;
      const stage = document.getElementById('inspect-stage')!.getBoundingClientRect();
      this.viewCamera.aspect = stage.width / Math.max(1, stage.height); this.viewCamera.updateProjectionMatrix();
      this.viewmodel.position.set(0, 0, -1.65); this.viewmodel.rotation.set(this.studioPitch, this.studioYaw, -0.08);
      this.viewmodel.scale.setScalar(Math.min(1.6, 1.98 * this.viewCamera.aspect * 0.8) / this.studioSpan * this.studioZoom);
    } else if (this.viewCamera.aspect !== this.camera.aspect) {
      this.viewCamera.aspect = this.camera.aspect; this.viewCamera.updateProjectionMatrix();
    }
    const studioInspect = time - this.studioInspectAt;
    animateWeapon(this.gun, { time, reload: this.studio ? 0 : reloadProgress, inspect: this.studio ? studioInspect < 3.4 ? studioInspect : -1 : inspecting ? inspectTime : -1, shotAge: this.studio ? 10 : time - this.shotAt, drawAge: this.studio ? 10 : time - this.switchAt, swingAge: this.currentWeapon === 'knife' ? time - this.swingAt : undefined, attack: this.swingCount });
    if (this.arms.userData.nativeArms && this.arms instanceof THREE.Group) animateWeapon(this.arms, { time, reload: reloadProgress, inspect: -1, shotAge: time - this.shotAt, drawAge: time - this.switchAt });
    const socket = this.gun.getObjectByName('muzzle-socket');
    if (socket) { this.viewmodel.updateMatrixWorld(true); this.flash.position.copy(this.viewmodel.worldToLocal(socket.getWorldPosition(new THREE.Vector3()))); }
    this.gun.visible = !this.retiring || time - this.switchAt > 0.12;
    if (this.retiring) {
      this.retiring.position.y -= dt * 3; this.retiring.rotation.z += dt * 4;
      if (time - this.switchAt > 0.12) { this.viewmodel.remove(this.retiring); disposeWeapon(this.retiring); this.retiring = null; }
    }
    this.recoil = THREE.MathUtils.damp(this.recoil, 0, 15, dt);
    const flashLife = Math.max(0, Math.min(1, (state.flash - time) / 0.065));
    this.flash.visible = flashLife > 0 && this.currentWeapon !== 'knife' && !this.studio;
    this.flash.scale.setScalar(this.flash.userData.size * (1.25 - flashLife * 0.3));
    (this.flash.material as THREE.MeshBasicMaterial).opacity = Math.min(1, flashLife * 2.5);
    this.flash.rotation.z = Math.floor(this.shotAt * 1000) % 17 * 0.37;
    this.renderer.domElement.dataset.muzzleEffect = 'textured-starburst';
    this.bomb.visible = !!state.bomb;
    if (state.bomb) this.bomb.position.set(state.bomb.x, state.bomb.y, state.bomb.z);
    for (let index = this.particles.length - 1; index >= 0; index--) {
      const particle = this.particles[index]; particle.life -= dt;
      if (particle.life <= 0) { this.removeParticle(particle); this.particles.splice(index, 1); continue; }
      if (particle.kind === 'shell' || particle.kind === 'spark') {
        particle.velocity.y -= dt * 7;
        particle.mesh.position.addScaledVector(particle.velocity, dt);
        particle.mesh.rotation.x += dt * 8; particle.mesh.rotation.z += dt * 7;
        if (particle.mesh.position.y < 0.025) { particle.mesh.position.y = 0.025; particle.velocity.set(0, 0, 0); }
      }
      if (particle.kind === 'smoke') { particle.mesh.position.addScaledVector(particle.velocity, dt); particle.mesh.scale.multiplyScalar(1 + dt * 0.7); (particle.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, particle.life / particle.max) * 0.55; }
      if (particle.kind === 'flash') { (particle.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, particle.life / particle.max * 2.5); }
    }
    this.renderer.setClearColor(this.studio ? '#151f22' : MAPS[this.mapId].palette.sky, 1);
    this.renderer.clear();
    if (!this.studio && this.outlineTargets.length) {
      if (!this.allyComposer) {
        const target = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.UnsignedByteType });
        this.allyComposer = new EffectComposer(this.renderer, target);
        this.allyComposer.addPass(new RenderPass(this.scene, this.camera));
        this.allyOutline = new OutlinePass(new THREE.Vector2(window.innerWidth, window.innerHeight), this.scene, this.camera);
        this.allyComposer.addPass(this.allyOutline); this.allyComposer.addPass(new OutputPass());
        this.allyComposer.setPixelRatio(Math.min(this.renderer.getPixelRatio(), 1.25)); this.allyComposer.setSize(window.innerWidth, window.innerHeight);
      }
      this.allyOutline!.selectedObjects = this.outlineTargets; configureAllyOutline(this.allyOutline!, this.viewerTeam); this.allyComposer.render(dt);
      this.renderer.setRenderTarget(null);
    } else if (!this.studio) this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    if (this.studio) {
      const stage = document.getElementById('inspect-stage')!.getBoundingClientRect(); const bottom = window.innerHeight - stage.bottom;
      this.renderer.setViewport(stage.left, bottom, stage.width, stage.height); this.renderer.setScissor(stage.left, bottom, stage.width, stage.height); this.renderer.setScissorTest(true);
    }
    this.renderer.render(this.viewScene, this.viewCamera);
    if (this.studio) { this.renderer.setScissorTest(false); this.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight); }
  }
}