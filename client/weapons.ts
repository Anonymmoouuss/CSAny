import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { KNIFE_CATALOG, WEAPONS, type WeaponId } from '../shared/game.ts';
import { CHARMS, CHARM_BY_ID, SKIN_BY_ID, DEFAULT_KNIFE_ID, seededRandom, type CharmDefinition, type SkinAppearance, type SkinDefinition, type KnifeKind } from '../shared/economy.ts';
import { assets, type ModelAnimation } from './assets.ts';

export function wearMarks(seed: number, wear: number, size = 256) {
  const amount = THREE.MathUtils.clamp(wear, 0, 1); const random = seededRandom(seed ^ 0x7f4a7c15);
  return Array.from({ length: Math.floor(amount * amount * 420) }, () => {
    const edge = random() < 0.65;
    return { x: edge ? random() < 0.5 ? random() * size * 0.15 : size * (0.85 + random() * 0.15) : random() * size, y: random() * size, length: size * (0.005 + random() * 0.1), width: 0.5 + random() * (1 + amount * 3), angle: (random() - 0.5) * 0.9, chip: random() < amount * 0.35 };
  });
}

export function patternCanvas(skin: SkinDefinition, appearance: SkinAppearance, size = 256) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const context = canvas.getContext('2d')!;
  const random = seededRandom(skin.seed + appearance.seed);
  const [base, accent, highlight] = skin.colors;
  context.fillStyle = base; context.fillRect(0, 0, size, size);
  if (skin.pattern === 'fade') {
    const gradient = context.createLinearGradient(0, size, size, 0);
    skin.colors.forEach((color, index) => gradient.addColorStop(index / (skin.colors.length - 1), color));
    context.fillStyle = gradient; context.fillRect(0, 0, size, size);
  }
  if (skin.pattern === 'camo') {
    for (let index = 0; index < 160; index++) {
      context.fillStyle = skin.colors[index % 3];
      const x = Math.floor(random() * 16) * size / 16; const y = Math.floor(random() * 16) * size / 16;
      context.fillRect(x, y, size / 16 * (1 + Math.floor(random() * 4)), size / 16 * (1 + Math.floor(random() * 3)));
    }
  }
  if (['chromatic', 'aurora'].includes(skin.pattern)) {
    const gradient = context.createLinearGradient(0, 0, size, size);
    [...skin.colors, '#e9fff1', ...skin.colors.slice().reverse()].forEach((color, index, colors) => gradient.addColorStop(index / (colors.length - 1), color));
    context.fillStyle = gradient; context.fillRect(0, 0, size, size);
    context.globalAlpha = 0.4;
    for (let index = 0; index < 18; index++) { context.strokeStyle = index % 3 ? highlight : '#ffffff'; context.lineWidth = size * 0.012; context.beginPath(); for (let step = 0; step <= 40; step++) { const x = step / 40 * size; const y = index / 18 * size + Math.sin(step / 6 + index) * size * 0.06; if (step) context.lineTo(x, y); else context.moveTo(x, y); } context.stroke(); }
    context.globalAlpha = 1;
  }
  if (skin.pattern === 'circuit') {
    context.lineWidth = size * 0.012;
    for (let index = 0; index < 35; index++) { const x = Math.floor(random() * 12) / 12 * size; const y = Math.floor(random() * 12) / 12 * size; const reach = (2 + Math.floor(random() * 5)) / 12 * size; context.strokeStyle = index % 3 ? accent : highlight; context.beginPath(); context.moveTo(x, y); context.lineTo(x + reach * 0.5, y); context.lineTo(x + reach * 0.75, y + reach * 0.25); context.lineTo(x + reach, y + reach * 0.25); context.stroke(); context.fillStyle = highlight; context.beginPath(); context.arc(x, y, size * 0.013, 0, Math.PI * 2); context.fill(); }
  }
  if (skin.pattern === 'glyph') {
    context.lineWidth = size * 0.009;
    for (let index = 0; index < 18; index++) { const x = random() * size; const y = random() * size; const radius = size * (0.035 + random() * 0.12); context.strokeStyle = index % 2 ? accent : highlight; context.beginPath(); for (let point = 0; point <= 6; point++) { const angle = point / 6 * Math.PI * 2; if (point) context.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius); else context.moveTo(x + radius, y); } context.stroke(); context.beginPath(); context.moveTo(x - radius, y); context.lineTo(x + radius, y); context.moveTo(x, y - radius); context.lineTo(x, y + radius); context.stroke(); }
  }
  if (skin.pattern === 'topographic') {
    context.lineWidth = size * 0.006;
    for (let index = 0; index < 32; index++) { context.strokeStyle = index % 5 ? accent : highlight; context.beginPath(); for (let step = 0; step <= 60; step++) { const x = step / 60 * size; const y = index / 32 * size + Math.sin(step / 8 + appearance.seed % 7) * size * 0.09 + Math.sin(step / 4 + index / 5) * size * 0.035; if (step) context.lineTo(x, y); else context.moveTo(x, y); } context.stroke(); }
  }
  if (['shards', 'ceramic'].includes(skin.pattern)) {
    if (skin.pattern === 'ceramic') { context.fillStyle = '#edf0eb'; context.fillRect(0, 0, size, size); }
    for (let index = 0; index < 55; index++) { const x = random() * size; const y = random() * size; const reach = size * (0.04 + random() * 0.25); context.fillStyle = skin.colors[index % 3]; context.strokeStyle = skin.pattern === 'ceramic' ? highlight : '#dce9dd'; context.lineWidth = size * 0.004; context.beginPath(); context.moveTo(x, y); context.lineTo(x + reach, y + reach * 0.2); context.lineTo(x + reach * 0.3, y + reach); context.closePath(); context.fill(); context.stroke(); }
  }
  if (['doppler', 'marble', 'hardened', 'hydro', 'slaughter', 'tiger'].includes(skin.pattern)) {
    for (let index = 0; index < 55; index++) {
      const x = random() * size; const y = random() * size;
      const radius = size * (0.07 + random() * 0.4);
      if (skin.pattern === 'tiger') {
        context.fillStyle = index % 3 ? accent : highlight;
        context.beginPath(); context.moveTo(x, y);
        context.bezierCurveTo(x + 25, y + 12, x - 15, y + 32, x + 75, y + 85);
        context.lineTo(x + 55, y + 80); context.bezierCurveTo(x - 20, y + 20, x + 10, y + 15, x, y); context.fill();
      } else if (skin.pattern === 'hydro' || skin.pattern === 'slaughter') {
        context.strokeStyle = skin.colors[index % 3]; context.lineWidth = 2 + random() * 11;
        context.beginPath(); context.moveTo(x - 80, y - 30);
        context.bezierCurveTo(x + 90, y - 90, x - 60, y + 80, x + 100, y + 30); context.stroke();
      } else {
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, skin.colors[index % 3]); gradient.addColorStop(1, `${skin.colors[index % 3]}00`);
        context.fillStyle = gradient; context.fillRect(0, 0, size, size);
      }
    }
  }
  context.globalAlpha = 0.08;
  for (let index = 0; index < 2000; index++) {
    context.fillStyle = random() > 0.5 ? '#ffffff' : '#000000';
    context.fillRect(random() * size, random() * size, 1, 1);
  }
  context.globalAlpha = 0.3 + appearance.float * 0.55;
  for (const mark of wearMarks(appearance.seed, appearance.float, size)) {
    context.save(); context.translate(mark.x, mark.y); context.rotate(mark.angle);
    context.fillStyle = '#222d2d'; context.fillRect(-0.5, -0.5, mark.length + 1, mark.width + 1);
    context.fillStyle = mark.chip ? '#8e9998' : '#c0c7bd'; context.fillRect(0, 0, mark.chip ? mark.length * 0.4 : mark.length, mark.chip ? mark.width * 2 : mark.width);
    context.restore();
  }
  context.globalAlpha = appearance.float * 0.1; context.fillStyle = '#6f776e'; context.fillRect(0, 0, size, size);
  context.globalAlpha = 1;
  return canvas;
}

function texture(skin: SkinDefinition | undefined, appearance?: SkinAppearance) {
  if (!skin || !appearance || typeof document === 'undefined') return null;
  const map = new THREE.CanvasTexture(patternCanvas(skin, appearance));
  map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 4;
  return map;
}

type Materials = { finish: THREE.MeshStandardMaterial; wood: THREE.MeshStandardMaterial; metal: THREE.MeshStandardMaterial; grip: THREE.MeshStandardMaterial; accent: THREE.MeshStandardMaterial; glass: THREE.MeshStandardMaterial };
export const FIELD_FINISHES: Record<WeaponId, string[]> = {
  rifle: ['#30332f', '#914c2d', '#62675e'], pistol: ['#333b3b', '#22292a', '#707b77'], sniper: ['#657044', '#30362d', '#889473'],
  carbine: ['#343b39', '#29302b', '#737d70'], battleRifle: ['#786b4e', '#44483a', '#a59972'], burstRifle: ['#424b43', '#2d3531', '#7a8679'], bullpup: ['#66704b', '#353d30', '#959f77'],
  smg: ['#303a3c', '#202c2e', '#657475'], vector: ['#514f42', '#2e342f', '#85816a'], machinePistol: ['#3f4547', '#242e32', '#7a888d'],
  shotgun: ['#414944', '#694732', '#8a8e80'], autoShotgun: ['#434b40', '#2b342c', '#7d8c70'], marksman: ['#575e42', '#323a2c', '#87946e'],
  scout: ['#536347', '#303c30', '#8c9d7c'], heavySniper: ['#646347', '#3b4037', '#9d9a73'], revolver: ['#454d50', '#684b35', '#8b9697'],
  servicePistol: ['#3b4143', '#252c2d', '#7b8586'], compactSmg: ['#4c5141', '#333b2e', '#8c9576'], lmg: ['#555b46', '#343d32', '#939878'],
  handCannon: ['#4d5558', '#2b3438', '#8e9b9e'], knife: ['#858c86', '#303b34', '#667361'],
};
export function applyFieldFinish(root: THREE.Object3D, id: WeaponId) {
  const touched = new Set<THREE.Material>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object.userData.hands) return;
    for (const original of [object.material].flat()) {
      if (!(original instanceof THREE.MeshStandardMaterial) || touched.has(original) || /lens|glass|glove|arms|sleeve/i.test(original.name)) continue;
      touched.add(original);
      const furniture = /wood|stock|grip|handguard/i.test(`${original.name} ${object.name}`);
      original.color.multiply(new THREE.Color(FIELD_FINISHES[id][furniture ? 1 : 0]));
      original.metalness = Math.min(original.metalness, 0.32); original.roughness = Math.max(original.roughness, 0.72); original.envMapIntensity = 0.3;
    }
  });
}
function materials(appearance?: SkinAppearance, fallback = ['#586d58', '#383f35', '#c1c99f']): Materials {
  const skin = appearance && SKIN_BY_ID.get(appearance.skinId);
  const colors = skin?.colors || fallback;
  const map = texture(skin || undefined, appearance);
  return {
    finish: new THREE.MeshStandardMaterial({ color: map ? '#ffffff' : colors[0], map, metalness: 0.25, roughness: appearance ? 0.55 + appearance.float * 0.35 : 0.76 }),
    wood: new THREE.MeshStandardMaterial({ color: skin ? colors[1] : '#9f5030', map: map?.clone() || null, roughness: 0.48, metalness: 0.12 }),
    metal: new THREE.MeshStandardMaterial({ color: '#333c42', roughness: 0.68, metalness: 0.32 }),
    grip: new THREE.MeshStandardMaterial({ color: '#26302f', roughness: 0.94 }),
    accent: new THREE.MeshStandardMaterial({ color: colors[2], roughness: 0.29, metalness: 0.66 }),
    glass: new THREE.MeshStandardMaterial({ color: '#386c83', roughness: 0.13, metalness: 0.8, emissive: '#16465b', emissiveIntensity: 0.35 }),
  };
}

function block(parent: THREE.Object3D, name: string, size: number[], position: number[], mat: THREE.Material, rotation = 0) {
  const geometry = new RoundedBoxGeometry(size[0], size[1], size[2], 1, Math.min(...size) * 0.16);
  const mesh = new THREE.Mesh(geometry, mat); mesh.name = name;
  mesh.position.set(position[0], position[1], position[2]); mesh.rotation.x = rotation; parent.add(mesh);
  return mesh;
}

function tube(parent: THREE.Object3D, name: string, radius: number, length: number, position: number[], mat: THREE.Material, top = radius) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, radius, length, 12), mat);
  mesh.name = name; mesh.rotation.x = Math.PI / 2; mesh.position.set(position[0], position[1], position[2]); parent.add(mesh);
  return mesh;
}

function profile(parent: THREE.Object3D, name: string, points: number[][], width: number, mat: THREE.Material) {
  const shape = new THREE.Shape();
  points.forEach(([longitudinal, height], index) => index ? shape.lineTo(longitudinal, height) : shape.moveTo(longitudinal, height));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.003, bevelSegments: 1, steps: 1 });
  geometry.rotateY(-Math.PI / 2); geometry.translate(width / 2, 0, 0);
  const mesh = new THREE.Mesh(geometry, mat); mesh.name = name; parent.add(mesh); return mesh;
}

function joint(parent: THREE.Object3D, name: string, position = [0, 0, 0]) {
  const group = new THREE.Group(); group.name = name; group.position.set(position[0], position[1], position[2]); parent.add(group);
  return group;
}

function ring(parent: THREE.Object3D, name: string, radius: number, position: number[], mat: THREE.Material, rotation = 0) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.006, 6, 18), mat);
  mesh.name = name; mesh.position.set(position[0], position[1], position[2]); mesh.rotation.y = rotation; parent.add(mesh); return mesh;
}

function rifle(root: THREE.Group, id: WeaponId, mat: Materials) {
  const ak = id === 'rifle';
  const bullpup = id === 'bullpup' || id === 'burstRifle';
  profile(root, 'receiver', [[-0.22, -0.035], [-0.22, 0.045], [-0.14, 0.075], [0.13, 0.07], [0.17, 0.02], [0.12, -0.055]], 0.082, mat.finish);
  tube(root, 'dust-cover', 0.044, 0.33, [0, 0.045, -0.02], mat.finish);
  tube(root, 'barrel', 0.014, 0.48, [0, 0.018, -0.53], mat.metal);
  tube(root, 'muzzle-brake', 0.026, 0.075, [0, 0.018, -0.79], mat.metal);
  block(root, 'muzzle-port', [0.055, 0.012, 0.027], [0, 0.031, -0.8], mat.grip);
  if (ak) {
    profile(root, 'wood-stock', [[0.16, 0.045], [0.43, 0.005], [0.53, -0.015], [0.53, -0.14], [0.44, -0.15], [0.23, -0.06], [0.17, -0.05]], 0.072, mat.wood);
    block(root, 'buttplate', [0.08, 0.16, 0.022], [0, -0.065, 0.53], mat.metal, -0.12);
    profile(root, 'lower-handguard', [[-0.21, 0.02], [-0.47, 0.025], [-0.47, -0.026], [-0.42, -0.045], [-0.22, -0.04]], 0.09, mat.wood);
    tube(root, 'gas-tube', 0.019, 0.31, [0, 0.075, -0.4], mat.metal);
    block(root, 'upper-handguard', [0.07, 0.045, 0.19], [0, 0.067, -0.33], mat.wood);
    const mag = joint(root, 'magazine');
    profile(mag, 'curved-magazine', [[-0.09, -0.035], [-0.01, -0.045], [0.01, -0.17], [-0.01, -0.27], [-0.07, -0.34], [-0.15, -0.30], [-0.11, -0.20]], 0.058, mat.finish);
    for (const side of [-1, 1]) for (let index = 0; index < 3; index++) block(mag, 'magazine-rib', [0.004, 0.17, 0.009], [side * 0.033, -0.18, -0.055 - index * 0.023], mat.metal, 0.2);
  } else if (bullpup) {
    profile(root, 'bullpup-stock', [[-0.18, 0.025], [0.4, 0.045], [0.43, -0.12], [0.15, -0.14], [-0.2, -0.045]], 0.105, mat.finish);
    const mag = joint(root, 'magazine', [0, 0, 0.24]);
    block(mag, 'rear-magazine', [0.06, 0.2, 0.11], [0, -0.19, 0], mat.metal, -0.13);
    for (const z of [-0.22, 0.1]) block(root, 'carry-support', [0.045, 0.12, 0.035], [0, 0.115, z], mat.metal);
    block(root, 'carry-handle', [0.055, 0.025, 0.37], [0, 0.175, -0.06], mat.finish);
    block(root, 'vented-fore-end', [0.09, 0.1, 0.25], [0, -0.01, -0.34], mat.finish);
  } else {
    tube(root, 'buffer-tube', 0.025, 0.26, [0, 0.02, 0.29], mat.metal);
    profile(root, 'adjustable-stock', [[0.25, 0.05], [0.46, 0.04], [0.48, -0.14], [0.4, -0.14], [0.31, -0.07]], 0.09, mat.finish);
    tube(root, 'quad-rail-handguard', 0.046, 0.3, [0, 0.01, -0.36], mat.finish);
    const mag = joint(root, 'magazine');
    block(mag, 'stanag-magazine', [0.055, 0.23, 0.1], [0, -0.16, -0.06], mat.finish, -0.12);
    for (let index = 0; index < 9; index++) block(root, 'rail-tooth', [0.071, 0.011, 0.012], [0, 0.067, -0.23 - index * 0.028], mat.metal);
  }
  const bolt = joint(root, 'bolt', [0.057, 0.035, 0.04]);
  block(bolt, 'charging-handle', [0.05, 0.018, 0.025], [0, 0, 0], mat.metal);
  block(root, 'pistol-grip', [0.058, 0.16, 0.07], [0, -0.13, 0.11], mat.grip, -0.34);
  ring(root, 'trigger-guard', 0.038, [0, -0.087, 0.034], mat.metal, Math.PI / 2);
  block(root, 'trigger', [0.009, 0.035, 0.011], [0, -0.073, 0.036], mat.metal, 0.3);
  block(root, 'front-sight-tower', [0.025, 0.096, 0.026], [0, 0.068, -0.65], mat.metal);
  ring(root, 'front-sight-ring', 0.025, [0, 0.121, -0.65], mat.metal);
  block(root, 'rear-sight', [0.05, 0.035, 0.025], [0, 0.104, -0.13], mat.metal);
  root.userData.muzzle = -0.84;
}

function pistol(root: THREE.Group, id: WeaponId, mat: Materials) {
  if (id === 'revolver') {
    tube(root, 'revolver-cylinder', 0.057, 0.12, [0, 0.025, -0.02], mat.finish);
    tube(root, 'revolver-barrel', 0.022, 0.23, [0, 0.049, -0.2], mat.metal);
    block(root, 'revolver-frame', [0.07, 0.06, 0.22], [0, 0.09, 0.015], mat.finish);
    block(root, 'revolver-grip', [0.065, 0.16, 0.075], [0, -0.095, 0.1], mat.wood, -0.28);
    ring(root, 'revolver-trigger-guard', 0.038, [0, -0.055, 0.01], mat.metal, Math.PI / 2);
    for (let index = 0; index < 6; index++) { const angle = index / 6 * Math.PI * 2; tube(root, 'cylinder-chamber', 0.008, 0.125, [Math.cos(angle) * 0.043, 0.025 + Math.sin(angle) * 0.043, -0.02], mat.grip); }
    root.userData.muzzle = -0.32; return;
  }
  const heavy = id === 'handCannon';
  const usp = id === 'pistol';
  const slide = joint(root, 'slide');
  profile(slide, 'slide-shell', [[-0.26, 0.01], [-0.25, 0.09], [0.045, 0.09], [0.075, 0.04], [0.07, -0.015]], heavy ? 0.087 : 0.068, mat.finish);
  tube(root, 'barrel', 0.017, 0.3, [0, 0.038, -0.14], mat.metal);
  if (usp) tube(root, 'suppressor', 0.03, 0.22, [0, 0.038, -0.4], mat.metal);
  profile(root, 'pistol-frame', [[-0.2, 0.005], [0.07, 0.015], [0.08, -0.06], [0.02, -0.08], [-0.1, -0.04], [-0.2, -0.035]], 0.061, mat.metal);
  block(root, 'grip', [0.065, 0.17, 0.09], [0, -0.115, 0.035], mat.grip, -0.27);
  const mag = joint(root, 'magazine');
  block(mag, 'pistol-magazine', [0.05, 0.14, 0.067], [0, -0.135, 0.03], mat.metal, -0.27);
  block(mag, 'magazine-base', [0.074, 0.022, 0.094], [0, -0.204, 0.048], mat.finish);
  ring(root, 'trigger-guard', 0.032, [0, -0.068, -0.064], mat.metal, Math.PI / 2);
  block(root, 'trigger', [0.009, 0.024, 0.012], [0, -0.057, -0.058], mat.metal, 0.3);
  for (let index = 0; index < 6; index++) block(slide, 'slide-serration', [0.075, 0.042, 0.005], [0, 0.052, 0.04 - index * 0.012], mat.metal);
  block(slide, 'front-sight', [0.012, 0.018, 0.014], [0, 0.103, -0.22], mat.accent);
  for (const x of [-0.022, 0.022]) block(slide, 'rear-sight', [0.012, 0.02, 0.025], [x, 0.1, 0.024], mat.metal);
  if (heavy) { root.scale.setScalar(1.16); block(slide, 'ejection-port', [0.089, 0.028, 0.06], [0, 0.059, -0.07], mat.metal); }
  root.userData.muzzle = usp ? -0.52 : -0.32;
}

function smg(root: THREE.Group, id: WeaponId, mat: Materials) {
  if (id === 'compactSmg') {
    profile(root, 'p90-frame', [[-0.36, 0.04], [0.24, 0.06], [0.32, -0.035], [0.32, -0.17], [0.12, -0.15], [-0.06, -0.07], [-0.33, -0.07]], 0.105, mat.finish);
    ring(root, 'thumbhole', 0.057, [0, -0.095, 0.11], mat.grip, Math.PI / 2);
    const mag = joint(root, 'magazine');
    block(mag, 'top-feed-magazine', [0.092, 0.045, 0.44], [0, 0.092, -0.04], mat.accent);
    for (let index = 0; index < 8; index++) tube(mag, 'visible-cartridge', 0.007, 0.07, [0, 0.09, -0.19 + index * 0.044], mat.metal);
    block(root, 'optic-bridge', [0.04, 0.05, 0.13], [0, 0.155, -0.06], mat.metal);
  } else {
    tube(root, 'tubular-receiver', 0.044, 0.36, [0, 0.02, -0.045], mat.finish);
    block(root, 'lower-receiver', [0.073, 0.06, 0.24], [0, -0.045, 0], mat.finish);
    block(root, 'fore-end', [0.08, 0.085, 0.2], [0, -0.006, -0.28], mat.grip);
    block(root, 'pistol-grip', [0.055, 0.16, 0.07], [0, -0.12, 0.09], mat.grip, -0.27);
    const mag = joint(root, 'magazine');
    block(mag, 'curved-smg-magazine', [0.04, 0.24, 0.065], [0, -0.16, -0.07], mat.finish, -0.15);
    for (const x of [-0.025, 0.025]) tube(root, 'retracting-stock-rail', 0.008, 0.26, [x, 0.005, 0.25], mat.metal);
    block(root, 'shoulder-pad', [0.065, 0.13, 0.024], [0, -0.025, 0.39], mat.grip);
    ring(root, 'diopter-sight', 0.023, [0, 0.087, 0.05], mat.metal);
  }
  const bolt = joint(root, 'bolt', [-0.045, 0.045, -0.14]);
  block(bolt, 'charging-handle', [0.04, 0.018, 0.025], [0, 0, 0], mat.metal);
  tube(root, 'barrel', 0.018, 0.2, [0, 0.024, -0.39], mat.metal);
  ring(root, 'front-sight', 0.029, [0, 0.085, -0.4], mat.metal);
  root.userData.muzzle = -0.51;
}

function sniper(root: THREE.Group, id: WeaponId, mat: Materials) {
  const scout = id === 'scout';
  profile(root, 'precision-stock', [[-0.37, -0.01], [0.18, -0.015], [0.34, -0.045], [0.53, -0.035], [0.54, -0.18], [0.35, -0.19], [0.2, -0.08], [-0.36, -0.075]], 0.1, mat.finish);
  tube(root, 'receiver', 0.038, 0.36, [0, 0.035, -0.08], mat.metal);
  tube(root, 'free-floating-barrel', scout ? 0.014 : 0.025, scout ? 0.63 : 0.76, [0, 0.035, -0.58], mat.metal);
  tube(root, 'muzzle-brake', 0.033, 0.07, [0, 0.035, scout ? -0.92 : -1.01], mat.finish);
  for (const z of [-0.22, 0.05]) block(root, 'scope-mount', [0.07, 0.085, 0.035], [0, 0.11, z], mat.metal);
  tube(root, 'scope-tube', 0.035, 0.3, [0, 0.175, -0.085], mat.metal);
  tube(root, 'scope-objective', 0.063, 0.11, [0, 0.175, -0.28], mat.finish, 0.043);
  tube(root, 'scope-lens', 0.055, 0.004, [0, 0.175, -0.337], mat.glass);
  tube(root, 'scope-eyepiece', 0.043, 0.07, [0, 0.175, 0.1], mat.metal);
  block(root, 'scope-turret', [0.055, 0.045, 0.055], [0, 0.222, -0.09], mat.metal);
  block(root, 'pistol-grip', [0.065, 0.17, 0.085], [0, -0.13, 0.16], mat.grip, -0.3);
  const mag = joint(root, 'magazine');
  block(mag, 'box-magazine', [0.062, 0.1, 0.115], [0, -0.12, -0.065], mat.finish);
  const bolt = joint(root, 'bolt', [0.07, 0.06, 0.1]);
  tube(bolt, 'bolt-handle', 0.009, 0.07, [0, -0.02, 0], mat.metal);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.019, 10, 8), mat.metal); knob.position.set(0, -0.035, 0); bolt.add(knob);
  for (const x of [-0.04, 0.04]) block(root, 'folded-bipod', [0.014, 0.018, 0.21], [x, -0.08, -0.35], mat.metal);
  root.userData.muzzle = scout ? -0.97 : -1.07;
}

function knife(root: THREE.Group, kind: KnifeKind, mat: Materials) {
  root.userData.knifeKind = kind;
  const pivot = joint(root, 'knife-pivot', [0, 0, 0.2]);
  const bladeRoot = joint(pivot, 'blade-root', [0, 0, -0.2]);
  if (kind === 'karambit') {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.bezierCurveTo(-0.075, 0.05, -0.13, 0.22, -0.035, 0.305);
    shape.bezierCurveTo(-0.005, 0.34, 0.055, 0.36, 0.11, 0.345);
    shape.bezierCurveTo(0.03, 0.34, -0.025, 0.255, 0.012, 0.185);
    shape.bezierCurveTo(0.04, 0.13, 0.065, 0.075, 0.06, 0.025); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.018, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.004, bevelThickness: 0.004 });
    geo.rotateX(-Math.PI / 2); geo.scale(0.65, 1, 1); bladeRoot.add(new THREE.Mesh(geo, mat.finish));
    ring(pivot, 'finger-ring', 0.052, [0, 0, 0.012], mat.accent).rotation.x = Math.PI / 2;
  } else {
    const length = kind === 'bayonet' ? 0.47 : kind === 'huntsman' ? 0.38 : 0.34;
    const blade = profile(bladeRoot, 'blade', [[-0.02, -0.035], [-length + 0.11, -0.045], [-length, 0.04], [-length + 0.13, 0.07], [-0.02, 0.045]], 0.014, mat.finish);
    if (kind === 'huntsman') {
      blade.scale.y = 1.6;
      for (let index = 0; index < 6; index++) block(bladeRoot, 'serrated-spine', [0.018, 0.02, 0.017], [0, 0.095, -0.07 - index * 0.038], mat.metal);
    }
    if (kind === 'bayonet') ring(bladeRoot, 'bayonet-lug', 0.026, [0, 0.06, 0], mat.metal, Math.PI / 2);
  }
  if (kind === 'butterfly') {
    for (const [index, x] of [-0.027, 0.027].entries()) {
      const handle = joint(bladeRoot, index ? 'butterfly-right' : 'butterfly-left', [x, 0, 0]);
      block(handle, 'split-handle', [0.03, 0.045, 0.25], [0, 0, 0.123], mat.finish);
      for (let hole = 0; hole < 5; hole++) block(handle, 'handle-inset', [0.033, 0.012, 0.018], [0, 0.023, 0.04 + hole * 0.037], mat.grip);
    }
  } else {
    block(bladeRoot, 'grip', [0.058, 0.055, 0.23], [0, 0, 0.11], mat.grip, kind === 'karambit' ? 0.08 : 0);
    for (let index = 0; index < 6; index++) block(bladeRoot, 'handle-groove', [0.064, 0.06, 0.009], [0, 0, 0.025 + index * 0.035], mat.accent);
    block(bladeRoot, 'guard', [0.11, 0.026, 0.027], [0, 0, -0.007], mat.metal);
  }
}

function batchParts(root: THREE.Group) {
  for (const child of [...root.children]) if (child instanceof THREE.Group) batchParts(child);
  root.updateMatrix(); const buckets = new Map<THREE.Material, THREE.Mesh[]>();
  for (const child of root.children) if (child instanceof THREE.Mesh && !Array.isArray(child.material)) {
    const parts = buckets.get(child.material) || []; parts.push(child); buckets.set(child.material, parts);
  }
  for (const [material, parts] of buckets) {
    if (parts.length < 2) continue;
    const geometries = parts.map(part => {
      part.updateMatrix(); const transformed = part.geometry.clone().applyMatrix4(part.matrix); const geometry = transformed.index ? transformed.toNonIndexed() : transformed;
      if (geometry !== transformed) transformed.dispose();
      const marker = new THREE.Object3D(); marker.name = part.name; marker.position.copy(part.position); marker.rotation.copy(part.rotation); root.add(marker); root.remove(part); part.geometry.dispose();
      return geometry;
    });
    const merged = mergeGeometries(geometries); geometries.forEach(geometry => geometry.dispose());
    const mesh = new THREE.Mesh(merged, material); mesh.name = 'static-parts'; mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh);
  }
}

export function charmPendant(definition: CharmDefinition) {
  const root = new THREE.Group(); root.name = 'charm-pendant'; root.userData.charmShape = definition.shape;
  const body = new THREE.MeshStandardMaterial({ color: definition.color, roughness: 0.48, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: definition.accent, roughness: 0.5, metalness: 0.25, emissive: definition.accent, emissiveIntensity: definition.rarity >= 4 ? 0.07 : 0 });
  const part = (geometry: THREE.BufferGeometry, material = body, position = [0, 0, 0]) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(position[0], position[1], position[2]); root.add(mesh); return mesh; };
  const plate = (points: number[][]) => { const shape = new THREE.Shape(); points.forEach(([x, y], index) => index ? shape.lineTo(x, y) : shape.moveTo(x, y)); shape.closePath(); return new THREE.ExtrudeGeometry(shape, { depth: 0.005, bevelEnabled: true, bevelSize: 0.001, bevelThickness: 0.001, bevelSegments: 1, steps: 1 }); };
  switch (definition.shape) {
    case 'die':
      part(new THREE.BoxGeometry(0.027, 0.027, 0.027));
      for (let index = 0; index < 1 + definition.seed % 6; index++) part(new THREE.SphereGeometry(0.0024, 6, 4), accent, [(index % 2 ? 1 : -1) * 0.006, (Math.floor(index / 2) - 1) * 0.006, 0.0135]);
      break;
    case 'cartridge':
      part(new THREE.CylinderGeometry(0.008, 0.009, 0.032, 10)); part(new THREE.ConeGeometry(0.008, 0.014, 10), accent, [0, 0.022, 0]); part(new THREE.CylinderGeometry(0.01, 0.01, 0.004, 10), accent, [0, -0.017, 0]); break;
    case 'gem': case 'diamond': {
      const crystal = part(new THREE.OctahedronGeometry(0.023)); crystal.scale.y = definition.shape === 'gem' ? 1.4 : 1; part(new THREE.TorusGeometry(0.015, 0.002, 4, 8), accent).rotation.x = Math.PI / 2; break;
    }
    case 'blade':
      part(plate([[-0.006, 0.02], [0.006, 0.02], [0.008, -0.01], [0, -0.031], [-0.008, -0.01]]), accent); part(new THREE.BoxGeometry(0.011, 0.018, 0.008), body, [0, 0.028, 0]); break;
    case 'star':
      part(plate(Array.from({ length: 10 }, (_, index) => { const angle = index / 10 * Math.PI * 2 + Math.PI / 2; const radius = index % 2 ? 0.01 : 0.025; return [Math.cos(angle) * radius, Math.sin(angle) * radius]; }))); break;
    case 'shield':
      part(plate([[-0.02, 0.023], [0.02, 0.023], [0.018, -0.008], [0, -0.027], [-0.018, -0.008]])); part(new THREE.BoxGeometry(0.003, 0.033, 0.002), accent, [0, 0, 0.007]); break;
    case 'ring':
      part(new THREE.TorusGeometry(0.018, 0.004, 6, 18)); part(new THREE.OctahedronGeometry(0.008), accent, [0, 0.019, 0]); break;
    case 'bolt':
      part(plate([[0.004, 0.028], [-0.018, -0.004], [-0.003, -0.003], [-0.006, -0.027], [0.02, 0.009], [0.003, 0.007]])); break;
    case 'pyramid':
      part(new THREE.TetrahedronGeometry(0.028)); part(new THREE.SphereGeometry(0.004, 6, 4), accent, [0, 0.022, 0]); break;
    case 'capsule':
      part(new THREE.CapsuleGeometry(0.011, 0.024, 3, 8)); part(new THREE.TorusGeometry(0.0115, 0.002, 4, 10), accent).rotation.x = Math.PI / 2; break;
    case 'beacon':
      part(new THREE.CylinderGeometry(0.014, 0.017, 0.018, 10), body, [0, -0.009, 0]); part(new THREE.SphereGeometry(0.014, 10, 6), accent, [0, 0.008, 0]); break;
    case 'skull': {
      part(new THREE.SphereGeometry(0.018, 10, 8)); part(new THREE.BoxGeometry(0.021, 0.013, 0.018), body, [0, -0.017, 0]);
      const dark = new THREE.MeshStandardMaterial({ color: '#182827', roughness: 0.9 }); for (const side of [-1, 1]) part(new THREE.SphereGeometry(0.0045, 6, 4), dark, [side * 0.007, 0.002, 0.015]); break;
    }
    case 'wing':
      part(plate([[-0.022, -0.02], [-0.018, 0.024], [0.023, 0.02], [0.008, 0.012], [0.018, 0.007], [0.002, 0], [0.009, -0.005], [-0.007, -0.014]])); break;
    case 'hex':
      part(new THREE.CylinderGeometry(0.023, 0.023, 0.007, 6)).rotation.x = Math.PI / 2; part(new THREE.OctahedronGeometry(0.01), accent, [0, 0, 0.007]); break;
    case 'crown':
      part(plate([[-0.023, 0.019], [-0.011, 0.009], [0, 0.027], [0.011, 0.009], [0.023, 0.019], [0.018, -0.018], [-0.018, -0.018]])); part(new THREE.BoxGeometry(0.036, 0.003, 0.006), accent, [0, -0.009, 0.006]); break;
    case 'rocket':
      part(new THREE.CylinderGeometry(0.009, 0.009, 0.034, 10)); part(new THREE.ConeGeometry(0.009, 0.017, 10), accent, [0, 0.025, 0]);
      for (const side of [-1, 1]) part(plate([[0, 0], [side * 0.019, -0.02], [0, -0.015]]), accent).position.y = -0.005; break;
    case 'key':
      part(new THREE.TorusGeometry(0.011, 0.003, 5, 14), body, [0, 0.015, 0]); part(new THREE.BoxGeometry(0.005, 0.028, 0.005), body, [0, -0.012, 0]);
      for (const y of [-0.016, -0.024]) part(new THREE.BoxGeometry(0.011, 0.004, 0.005), accent, [0.004, y, 0]); break;
    case 'crescent': {
      const shape = new THREE.Shape(); shape.absarc(0, 0, 0.025, Math.PI * 0.35, Math.PI * 1.65, false); shape.bezierCurveTo(-0.004, -0.016, -0.004, 0.016, Math.cos(Math.PI * 0.35) * 0.025, Math.sin(Math.PI * 0.35) * 0.025); shape.closePath();
      part(new THREE.ExtrudeGeometry(shape, { depth: 0.005, bevelEnabled: false })); break;
    }
    default:
      part(new RoundedBoxGeometry(0.024, 0.036, 0.005, 1, 0.003)); part(new THREE.BoxGeometry(0.015, 0.002, 0.001), accent, [0, -0.002, 0.003]); part(new THREE.BoxGeometry(0.009, 0.002, 0.001), accent, [-0.003, -0.009, 0.003]);
  }
  root.rotation.y = (definition.seed % 5 - 2) * 0.06; return root;
}

function weaponCharm(root: THREE.Group, appearance?: SkinAppearance) {
  const definition = appearance?.charm && CHARM_BY_ID.get(appearance.charm); if (!definition) return;
  const group = new THREE.Group(); group.name = 'weapon-charm'; group.position.set(0.06, -0.02, 0.06); group.userData.seed = appearance!.seed;
  const metal = new THREE.MeshStandardMaterial({ color: '#8c9b94', metalness: 0.35, roughness: 0.56 });
  for (let index = 0; index < 3; index++) { const link = new THREE.Mesh(new THREE.TorusGeometry(0.006, 0.0018, 5, 10), metal); link.position.y = -index * 0.009; link.rotation.y = index % 2 * Math.PI / 2; group.add(link); }
  const pendant = charmPendant(definition); pendant.position.y = -0.052; group.add(pendant); root.add(group);
}

export function buildWeapon(id: WeaponId, appearance?: SkinAppearance, knifeStyle = 0, colors?: string[], context: 'view' | 'world' | 'preview' = 'preview') {
  const definition = appearance && SKIN_BY_ID.get(appearance.skinId);
  const fieldIssue = !appearance || definition?.id === `${id}-0` || definition?.id === DEFAULT_KNIFE_ID;
  const supportedKnife = id !== 'knife' || !definition?.knife || definition.knife === 'karambit';
  const customAsset = definition?.asset;
  if (customAsset && !assets.has(customAsset)) void assets.load(customAsset);
  const imported = typeof window !== 'undefined' && definition?.id !== DEFAULT_KNIFE_ID ? customAsset ? assets.instantiate(customAsset, 'weapon', 0.34, context) : supportedKnife ? assets.weapon(id, context) : null : null;
  if (imported) {
    if (id === 'knife' && (definition?.knife || 'karambit') === 'karambit') {
      const motion = imported.userData.motion as THREE.Group; const pivot = new THREE.Group(); pivot.name = 'knife-finger-pivot'; pivot.position.z = 0.1;
      imported.add(pivot); pivot.add(motion); motion.position.z -= 0.1; pivot.userData.basePosition = pivot.position.clone(); imported.userData.motion = pivot;
    }
    if (fieldIssue) applyFieldFinish(imported, id);
    if (appearance && definition && !fieldIssue) {
      const pattern = patternCanvas(definition, appearance, 512);
      const painted = new Map<THREE.Material, THREE.Material>();
      imported.traverse(object => {
        if (!(object instanceof THREE.Mesh) || object.userData.hands || !object.visible) return;
        const apply = (original: THREE.Material) => {
          if (painted.has(original)) return painted.get(original)!;
          const material = original as THREE.MeshStandardMaterial;
          if (!('roughness' in material) || /lens|glass|glove|arms|sleeve/i.test(material.name)) return original;
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512; const context = canvas.getContext('2d')!;
          if (material.map?.image) context.drawImage(material.map.image, 0, 0, 512, 512);
          else { context.fillStyle = '#c8c8c8'; context.fillRect(0, 0, 512, 512); }
          context.globalCompositeOperation = 'source-over'; context.globalAlpha = Math.min(0.99, 0.94 + definition.rarity * 0.01); context.drawImage(pattern, 0, 0);
          const map = new THREE.CanvasTexture(canvas); map.flipY = material.map?.flipY ?? false; map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; map.wrapS = map.wrapT = THREE.RepeatWrapping;
          if (material.map && !material.map.userData.assetShared) material.map.dispose();
          material.map = map; material.color.set('#ffffff'); material.metalness = Math.min(material.metalness, 0.22); material.envMapIntensity = 0.3; material.roughness = Math.min(0.95, 0.52 + appearance.float * 0.35); material.userData.appliedSkin = definition.id; material.needsUpdate = true; painted.set(original, material); return material;
        };
        object.material = Array.isArray(object.material) ? object.material.map(apply) : apply(object.material);
      });
    }
    if (appearance?.statTrak) {
      const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 48; const context = canvas.getContext('2d')!;
      context.fillStyle = '#161d1f'; context.fillRect(0, 0, 128, 48); context.fillStyle = '#f6a760'; context.font = 'bold 30px monospace'; context.textAlign = 'center'; context.fillText(String(appearance.kills).padStart(6, '0'), 64, 35);
      const module = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.028), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), side: THREE.DoubleSide })); module.position.set(0.045, 0.04, 0.03); module.rotation.y = Math.PI / 2; imported.add(module);
    }
    weaponCharm(imported, appearance); imported.userData.weapon = id; imported.userData.knifeKind = definition?.knife || 'karambit'; return imported;
  }
  const root = new THREE.Group(); root.name = `weapon-${id}`;
  const mat = materials(fieldIssue ? undefined : appearance, colors || FIELD_FINISHES[id]);
  if (id === 'knife') knife(root, definition?.knife || (['karambit', 'butterfly', 'bayonet', 'huntsman', 'flip'] as KnifeKind[])[knifeStyle % 5], mat);
  else if (WEAPONS[id].model === 'pistol') pistol(root, id, mat);
  else if (WEAPONS[id].model === 'sniper') sniper(root, id, mat);
  else if (WEAPONS[id].model === 'smg') smg(root, id, mat);
  else {
    rifle(root, id, mat);
    if (WEAPONS[id].model === 'shotgun') {
      tube(root, 'shell-tube', 0.022, 0.45, [0, -0.037, -0.48], mat.metal);
      block(root, 'pump', [0.105, 0.085, 0.24], [0, -0.025, -0.4], mat.grip);
    }
    if (id === 'lmg') tube(root, 'drum-magazine', 0.09, 0.11, [0, -0.17, -0.06], mat.finish);
  }
  let section = 0;
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true; object.receiveShadow = true;
    const source = object.material as THREE.MeshStandardMaterial;
    if (definition?.wrap && source.map) {
      const uv = object.geometry.getAttribute('uv');
      if (uv) for (let index = 0; index < uv.count; index++) uv.setXY(index, uv.getX(index) * (0.3 + section % 3 * 0.12) + (section * 0.193) % 1, uv.getY(index) * 0.65 + (section * 0.137) % 1);
      section++;
    }
    object.userData.restPosition = object.position.clone(); object.userData.restRotation = object.rotation.clone();
  });
  for (const name of ['magazine', 'bolt', 'slide', 'butterfly-left', 'butterfly-right', 'knife-pivot']) {
    const part = root.getObjectByName(name);
    if (part) { part.userData.restPosition = part.position.clone(); part.userData.restRotation = part.rotation.clone(); }
  }
  if (appearance?.statTrak) {
    block(root, 'stattrak-module', [0.006, 0.037, 0.07], [0.05, 0.035, 0.005], mat.accent);
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 48;
      const context = canvas.getContext('2d')!; context.fillStyle = '#171d1d'; context.fillRect(0, 0, 128, 48);
      context.fillStyle = '#f6a760'; context.font = 'bold 32px monospace'; context.textAlign = 'center'; context.fillText(String(appearance.kills).padStart(6, '0'), 64, 36);
      const counter = new THREE.Mesh(new THREE.PlaneGeometry(0.067, 0.03), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas) }));
      counter.position.set(0.054, 0.036, 0.005); counter.rotation.y = Math.PI / 2; root.add(counter);
    }
  }
  root.userData.weapon = id;
  root.userData.legacyKnife = KNIFE_CATALOG[knifeStyle]?.name;
  weaponCharm(root, appearance);
  const muzzle = new THREE.Object3D(); muzzle.name = 'muzzle-socket'; muzzle.position.set(0, 0.035, root.userData.muzzle || -0.4); root.add(muzzle);
  const motion = new THREE.Group(); motion.name = 'inspection-motion';
  if (id === 'knife') motion.scale.setScalar(0.5);
  for (const child of [...root.children]) motion.add(child);
  root.add(motion); root.userData.proceduralMotion = motion;
  batchParts(root);
  return root;
}

export function inspectPose(id: WeaponId, age: number, kind: KnifeKind = 'karambit') {
  const rest = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0, spin: 0 };
  if (age < 0 || age >= 3.4) return rest;
  const index = Object.keys(WEAPONS).indexOf(id);
  const envelope = THREE.MathUtils.smoothstep(age, 0, 0.42) * (1 - THREE.MathUtils.smoothstep(age, 2.85, 3.4));
  const turn = Math.sin(age * (1.5 + index * 0.035));
  const knife = id === 'knife';
  const firstSpin = THREE.MathUtils.smoothstep(age, 0.35, 1.1); const secondSpin = THREE.MathUtils.smoothstep(age, 1.75, 2.55);
  return { x: envelope * (knife ? -0.07 : -0.025 - index * 0.001), y: envelope * (0.025 + index % 4 * 0.008), z: envelope * (0.035 + index % 3 * 0.012),
    pitch: envelope * Math.sin(age * 1.8 + index * 0.13) * (knife ? 0.18 : 0.08 + index % 4 * 0.018),
    yaw: envelope * turn * (0.29 + index % 7 * 0.035), roll: envelope * Math.sin(age * 2 + index * 0.2) * (knife ? 0.28 : 0.14 + index % 5 * 0.025),
    spin: knife ? (firstSpin - (kind === 'karambit' ? secondSpin : 0)) * Math.PI * 2 + (kind === 'butterfly' ? secondSpin * Math.PI * 2 : 0) : 0 };
}

export function meleePose(age: number, attack = 0) {
  if (age < 0 || age >= 0.45) return { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
  const progress = age / 0.45;
  const windup = THREE.MathUtils.smoothstep(progress, 0, 0.22);
  const slash = THREE.MathUtils.smoothstep(progress, 0.22, 0.56);
  const recovery = 1 - THREE.MathUtils.smoothstep(progress, 0.56, 1);
  if (attack % 3 === 2) return { x: -0.035 * slash * recovery, y: 0.045 * windup * recovery, z: -0.34 * slash * recovery, pitch: -0.08 * windup * recovery, yaw: 0.08 * windup * recovery, roll: -0.16 * windup * recovery };
  const side = attack % 2 ? -1 : 1;
  return { x: (0.045 * windup - 0.25 * slash) * recovery * side, y: (0.04 * windup - 0.1 * slash) * recovery,
    z: (-0.23 * slash + 0.025 * windup) * recovery, pitch: (-0.12 * windup + 0.26 * slash) * recovery,
    yaw: (0.2 * windup - 0.52 * slash) * recovery * side, roll: (-0.14 * windup + 0.75 * slash) * recovery * side };
}

export function knifeHoldPose(inspectAge: number, swingAge: number, attack = 0) {
  const inspecting = inspectAge >= 0 && inspectAge < 3.4;
  const envelope = inspecting ? THREE.MathUtils.smoothstep(inspectAge, 0, 0.4) * (1 - THREE.MathUtils.smoothstep(inspectAge, 2.9, 3.4)) : 0;
  const swing = meleePose(swingAge, attack);
  return { x: 0.25 - envelope * 0.1 + swing.x, y: -0.27 + envelope * 0.1 + swing.y, z: -0.55 + envelope * 0.07 + swing.z,
    pitch: 0.28 - envelope * 0.08 + swing.pitch, yaw: -0.3 + envelope * 0.24 + swing.yaw, roll: 0.68 - envelope * 0.18 + swing.roll };
}

export function animateWeapon(root: THREE.Group, state: { time: number; reload: number; inspect: number; shotAge: number; drawAge?: number; swingAge?: number; attack?: number }) {
  const hands = root.userData.handRig as THREE.Group | undefined;
  if (hands) (hands.userData.animation as ModelAnimation).update(state.time, state);
  const charm = root.getObjectByName('weapon-charm');
  if (charm) { charm.rotation.z = Math.sin(state.time * 4 + (charm.userData.seed || 0)) * 0.1 + Math.max(0, 1 - state.shotAge / 0.3) * Math.sin(state.shotAge * 26) * 0.28; charm.rotation.x = Math.sin(state.time * 3.1) * 0.07; }
  const animation = root.userData.animation as ModelAnimation | undefined;
  const pose = inspectPose(root.userData.weapon || 'rifle', state.inspect, root.userData.knifeKind);
  if (animation) {
    animation.update(state.time, state);
    const motion = root.userData.motion as THREE.Group | undefined;
    if (motion) {
      const reload = !animation.has('reload') && state.reload > 0 ? Math.sin(state.reload * Math.PI) : 0;
      const weight = animation.has('inspect') ? 0.18 : 1;
      const draw = !animation.has('draw') && state.drawAge !== undefined ? Math.max(0, 1 - state.drawAge / 0.45) : 0;
      motion.position.set(-reload * 0.045 + pose.x * weight, -reload * 0.08 - draw * 0.12 + pose.y * weight, Math.max(0, 1 - state.shotAge / 0.12) * 0.015 + pose.z * weight);
      if (motion.userData.basePosition) motion.position.add(motion.userData.basePosition);
      const ringSpin = root.userData.weapon === 'knife' && root.userData.knifeKind === 'karambit';
      motion.rotation.set(reload * 0.22 + draw * 0.3 + pose.pitch * weight, (motion.userData.baseYaw || 0) + pose.yaw * weight + (ringSpin && !animation.has('inspect') ? pose.spin : 0), -reload * 0.32 + pose.roll * weight + (!ringSpin && !animation.has('inspect') ? pose.spin : 0));
    }
    return;
  }
  const progress = state.reload;
  const motion = root.userData.proceduralMotion as THREE.Group | undefined;
  if (motion) { motion.position.set(pose.x, pose.y, pose.z); motion.rotation.set(pose.pitch, pose.yaw, pose.roll); }
  const mag = root.getObjectByName('magazine');
  if (mag) {
    mag.position.copy(mag.userData.restPosition);
    mag.rotation.copy(mag.userData.restRotation);
    if (progress > 0) {
      const drop = progress < 0.25 ? progress / 0.25 : progress < 0.58 ? 1 : Math.max(0, 1 - (progress - 0.58) / 0.22);
      mag.position.y -= drop * 0.36; mag.position.x -= drop * 0.1; mag.rotation.x += drop * 0.25;
      mag.visible = !(progress > 0.35 && progress < 0.57);
    } else mag.visible = true;
  }
  const bolt = root.getObjectByName('bolt') || root.getObjectByName('slide');
  if (bolt) {
    bolt.position.copy(bolt.userData.restPosition);
    const pull = progress > 0.8 ? Math.sin((progress - 0.8) / 0.2 * Math.PI) : state.inspect > 1.9 && state.inspect < 2.5 ? Math.sin((state.inspect - 1.9) / 0.6 * Math.PI) : 0;
    bolt.position.z += pull * 0.1 + Math.max(0, 1 - state.shotAge / 0.12) * 0.035;
  }
  const pivot = root.getObjectByName('knife-pivot');
  if (pivot) {
    const elapsed = state.inspect;
    const envelope = elapsed >= 0 && elapsed < 3.6 ? Math.sin(Math.min(1, elapsed / 0.45) * Math.PI / 2) * Math.sin(Math.min(1, (3.6 - elapsed) / 0.5) * Math.PI / 2) : 0;
    pivot.rotation.set(0, 0, 0);
    if (root.userData.knifeKind === 'karambit') {
      pivot.rotation.y = pose.spin;
      pivot.rotation.x = envelope * Math.sin(elapsed * 2.2) * 0.14;
      pivot.rotation.z = envelope * Math.sin(elapsed * 1.8) * 0.12;
    } else if (root.userData.knifeKind === 'butterfly') {
      pivot.rotation.z = envelope * Math.sin(elapsed * 6) * 0.8;
      for (const [index, name] of ['butterfly-left', 'butterfly-right'].entries()) {
        const handle = root.getObjectByName(name)!;
        handle.rotation.x = envelope ? envelope * Math.sin(elapsed * 9 + index * 1.5) * Math.PI : 0;
        handle.rotation.z = envelope ? envelope * Math.sin(elapsed * 5 + index * 2) * 0.3 : 0;
      }
    } else pivot.rotation.z = envelope * Math.sin(elapsed * 3) * 1.6;
  }
}

export function disposeWeapon(model: THREE.Object3D) {
  model.traverse(object => { (object.userData.animation as ModelAnimation | undefined)?.dispose(); });
  const materials = new Set<THREE.Material>(); const maps = new Set<THREE.Texture>();
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    if (!object.geometry.userData.assetShared && !object.userData.sharedGeometry) object.geometry.dispose();
    if (object instanceof THREE.SkinnedMesh && !object.userData.sharedSkeleton) object.skeleton.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const) {
        const map = (material as THREE.MeshStandardMaterial)[key]; if (map) maps.add(map);
      }
    }
  });
  materials.forEach(material => material.dispose()); maps.forEach(map => { if (!map.userData.assetShared) map.dispose(); });
}