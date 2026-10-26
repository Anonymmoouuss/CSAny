import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Box3, BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { capsuleClear, encodeMapGeometry, spawnGroup, walkLink, type ImportedMapMetadata, type SurfaceMaterial } from '../shared/map-geometry.ts';

const directory = new URL('../client/public/models/imported/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const levels: Record<string, ImportedMapMetadata> = {};
const names: Record<string, string> = { arena: 'Arena', breeze: 'Breeze', dune: 'Dune', dust2: 'Dust II Classic', rust: 'Rust', sandstone: 'Sandstone', zona7: 'Zone 7', collection: 'Training Grounds', outpost: 'Outpost', resoforge: 'Freight Yard' };
const only = process.argv.find(argument => argument.startsWith('--only='))?.slice(7).split(',');
if (only) Object.assign(levels, JSON.parse(await readFile(new URL('../shared/imported-maps.json', import.meta.url), 'utf8').catch(() => '{}')));

for (const [id, entry] of Object.entries(manifest) as [string, { kind: string; url: string }][]) {
  if (entry.kind !== 'map' || only && !only.includes(id)) continue;
  const document = await io.read(new URL(`${id}.glb`, directory).pathname); const positions: number[] = []; const indices: number[] = []; const navigationFaces: boolean[] = []; const triangleSurfaces: number[] = []; const collisionSurfaces: SurfaceMaterial[] = ['wood', 'drywall', 'concrete', 'steel', 'glass']; const point = new Vector3();
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue; const matrix = new Matrix4().fromArray(node.getWorldMatrix());
    for (const primitive of mesh.listPrimitives()) {
      const material = primitive.getMaterial(); if (/^(grass|plants|decals)$/i.test(node.getName()) || material && (/water|sky|plant|decal|glass|particle|mountain|background/i.test(material.getName()) || material.getBaseColorFactor()[3] < 0.5)) continue;
      const attribute = primitive.getAttribute('POSITION'); const vertices = attribute?.getArray(); if (!vertices) continue;
      const offset = positions.length / 3;
      for (let index = 0; index < vertices.length; index += 3) { point.set(vertices[index], vertices[index + 1], vertices[index + 2]).applyMatrix4(matrix); positions.push(point.x, point.y, point.z); }
      const source = primitive.getIndices()?.getArray(); const start = indices.length;
      if (source) for (const index of source) indices.push(offset + index); else for (let index = 0; index < vertices.length / 3; index++) indices.push(offset + index);
      const name = `${node.getName()} ${material?.getName() || ''}`;
      const surface: SurfaceMaterial = /wood|crate|plank|timber/i.test(name) ? 'wood' : /steel|metal|iron/i.test(name) ? 'steel' : /glass/i.test(name) ? 'glass' : /drywall|plaster|stucco/i.test(name) ? 'drywall' : 'concrete';
      for (let index = start; index < indices.length; index += 3) { navigationFaces.push(!/^grass$/i.test(material?.getName() || '')); triangleSurfaces.push(collisionSurfaces.indexOf(surface)); }
    }
  }
  let bounds = new Box3().setFromArray(positions); const size = bounds.getSize(new Vector3()); const rotation = new Matrix4();
  if (size.x < size.y && size.x < size.z) rotation.makeRotationZ(Math.PI / 2); else if (size.z < size.y && size.z < size.x) rotation.makeRotationX(-Math.PI / 2);
  for (let index = 0; index < positions.length; index += 3) { point.fromArray(positions, index).applyMatrix4(rotation).toArray(positions, index); }
  bounds = new Box3().setFromArray(positions);
  if (id === 'breeze') {
    for (const [axis, component] of [['x', 0], ['z', 2]] as const) {
      const values = positions.filter((_, index) => index % 3 === component).sort((first, second) => first - second);
      bounds.min[axis] = values[Math.floor(values.length * 0.01)]; bounds.max[axis] = values[Math.floor(values.length * 0.99)];
    }
  }
  const center = bounds.getCenter(new Vector3()); const scale = 208 / Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
  const transform = new Matrix4().makeScale(scale, scale, scale).multiply(new Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z)).multiply(rotation);
  const undoRotation = rotation.clone().invert();
  for (let index = 0; index < positions.length; index += 3) point.fromArray(positions, index).applyMatrix4(undoRotation).applyMatrix4(transform).toArray(positions, index);
  const vertices = new Float32Array(positions); const triangles = new Uint32Array(indices); const geometry = new BufferGeometry(); geometry.setAttribute('position', new BufferAttribute(vertices, 3)); geometry.setIndex(new BufferAttribute(triangles, 1));
  geometry.computeBoundingBox(); bounds = geometry.boundingBox!; const bvh = new MeshBVH(geometry, { targetLeafSize: 12, indirect: true });
  const cell = id === 'breeze' || id === 'dune' ? 0.75 : 1; const points = new Map<string, { x: number; y: number; z: number }>(); const surfaces = new Map<string, { x: number; y: number; z: number }[]>(); const heights = new Map<number, number>(); const ray = new Ray(new Vector3(), new Vector3(0, -1, 0));
  const architecturalHeights = new Map<number, number>(); const floorCover = new WeakMap<{ x: number; y: number; z: number }, boolean>(); const floorWalls = new WeakMap<{ x: number; y: number; z: number }, number>();
  for (let x = Math.ceil(bounds.min.x / cell) * cell; x < bounds.max.x; x += cell) for (let z = Math.ceil(bounds.min.z / cell) * cell; z < bounds.max.z; z += cell) {
    ray.origin.set(x, bounds.max.y + 2, z);
    const hits = bvh.raycast(ray, DoubleSide, 0, bounds.max.y - bounds.min.y + 5).filter(hit => navigationFaces[hit.faceIndex!] && Math.abs(hit.face!.normal.y) > 0.55).sort((first, second) => first.point.y - second.point.y);
    for (const hit of hits) {
      const feet = { x, y: hit.point.y + 0.003, z }; if (!capsuleClear(bvh, feet, 1.8, 0.31)) continue;
      const key = `${x / cell},${z / cell}`; const candidates = surfaces.get(key) || [];
      if (candidates.some(point => Math.abs(point.y - feet.y) < 0.1)) continue;
      candidates.push(feet); surfaces.set(key, candidates); const floor = Math.round(feet.y); heights.set(floor, (heights.get(floor) || 0) + 1);
      if (id === 'dune' || id === 'breeze') {
        let walls = 0;
        for (let direction = 0; direction < 8; direction++) { const angle = direction / 8 * Math.PI * 2; const hit = bvh.raycastFirst(new Ray(new Vector3(x, feet.y + 1.1, z), new Vector3(Math.sin(angle), 0, Math.cos(angle))), DoubleSide, 0, 35); if (hit && Math.abs(hit.face!.normal.y) < 0.65) walls++; }
        if (walls >= 6) architecturalHeights.set(floor, (architecturalHeights.get(floor) || 0) + 1);
        floorWalls.set(feet, walls);
        floorCover.set(feet, !!bvh.raycastFirst(new Ray(new Vector3(x, feet.y + 1.85, z), new Vector3(0, 1, 0)), DoubleSide, 0, 12));
      }
    }
  }
  const mainHeight = [...(architecturalHeights.size ? architecturalHeights : heights)].sort((first, second) => second[1] - first[1])[0]?.[0] || 0;
  for (const [key, candidates] of surfaces) points.set(key, candidates.sort((first, second) => id === 'zona7' ? first.y - second.y : Number(floorCover.get(second) || false) - Number(floorCover.get(first) || false) || Math.abs(first.y - mainHeight) - Math.abs(second.y - mainHeight))[0]);
  const remaining = new Set(points.keys()); let connected: { x: number; y: number; z: number }[] = []; let connectedScore = -1;
  while (remaining.size) {
    const queue = [remaining.values().next().value!]; const region = []; remaining.delete(queue[0]);
    for (let index = 0; index < queue.length; index++) {
      const current = points.get(queue[index])!; region.push(current);
      for (const [dx, dz] of [[cell, 0], [-cell, 0], [0, cell], [0, -cell]]) { const key = `${(current.x + dx) / cell},${(current.z + dz) / cell}`; const neighbor = points.get(key); if (neighbor && remaining.has(key) && walkLink(bvh, current, neighbor)) { remaining.delete(key); queue.push(key); } }
    }
    const score = architecturalHeights.size ? region.filter(point => (floorWalls.get(point) || 0) >= 6 && point.y <= mainHeight + 1).length : region.length;
    if (score > connectedScore || score === connectedScore && region.length > connected.length) { connected = region; connectedScore = score; }
  }
  if (connected.length < 100) throw new Error(`${id}: only ${connected.length} connected cells from ${points.size} floor candidates at main height ${mainHeight}`);
  const clear = connected.filter(feet => capsuleClear(bvh, feet, 1.8, 0.7)); const safe = clear.length >= 20 ? clear : connected;
  const sheltered = safe.filter(point => {
    if (id === 'zona7' && (point.y > mainHeight + 1 || !bvh.raycastFirst(new Ray(new Vector3(point.x, point.y + 1.85, point.z), new Vector3(0, 1, 0)), DoubleSide, 0, 8))) return false;
    if ((id === 'dune' || id === 'breeze') && point.y > mainHeight + 1) return false;
    let walls = 0;
    for (let direction = 0; direction < 12; direction++) {
      const angle = direction / 12 * Math.PI * 2;
      const hit = bvh.raycastFirst(new Ray(new Vector3(point.x, point.y + 1.1, point.z), new Vector3(Math.sin(angle), 0, Math.cos(angle))), DoubleSide, 0, id === 'dune' || id === 'breeze' ? 35 : 60);
      if (hit && Math.abs(hit.face!.normal.y) < 0.65) walls++;
    }
    return walls >= 9;
  });
  if (sheltered.length < 20) throw new Error(`${id}: only ${sheltered.length} protected interior spawn candidates`);
  function distances(start: typeof safe[number]) {
    const cells = new Map(connected.map(point => [`${Math.round(point.x / cell)},${Math.round(point.z / cell)}`, point]));
    const queue = [start]; const result = new Map<typeof start, number>([[start, 0]]);
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      for (const [dx, dz] of [[cell, 0], [-cell, 0], [0, cell], [0, -cell]]) {
        const neighbor = cells.get(`${Math.round((current.x + dx) / cell)},${Math.round((current.z + dz) / cell)}`);
        if (neighbor && !result.has(neighbor) && walkLink(bvh, current, neighbor)) { result.set(neighbor, result.get(current)! + cell); queue.push(neighbor); }
      }
    }
    return result;
  }
  const initial = distances(sheltered[0]); const firstEnd = [...sheltered].sort((first, second) => (initial.get(second) || 0) - (initial.get(first) || 0))[0];
  const firstDistances = distances(firstEnd); const secondEnd = [...sheltered].sort((first, second) => (firstDistances.get(second) || 0) - (firstDistances.get(first) || 0))[0];
  const CT = spawnGroup(bvh, sheltered, firstEnd);
  const separated = sheltered.filter(point => CT.every(other => Math.hypot(point.x - other.x, point.z - other.z) > (id === 'breeze' ? 75 : 40)));
  const spawns = { CT, T: spawnGroup(bvh, separated, secondEnd) };
  if (spawns.CT.length < 5 || spawns.T.length < 5) throw new Error(`${id}: insufficient compact team starts (${connected.length} cells, ${sheltered.length} sheltered, CT ${spawns.CT.length}, T ${spawns.T.length}, ${separated.length} separated candidates)`);
  const candidates = safe.filter(point => [...spawns.CT, ...spawns.T].every(start => Math.hypot(point.x - start.x, point.z - start.z) >= 10));
  const firstSite = [...candidates].sort((first, second) => Math.abs((firstDistances.get(first) || 0) - firstDistances.get(secondEnd)! * 0.35) - Math.abs((firstDistances.get(second) || 0) - firstDistances.get(secondEnd)! * 0.35))[0];
  const secondSite = firstSite && [...candidates].filter(point => Math.hypot(point.x - firstSite.x, point.z - firstSite.z) >= 36).sort((first, second) => (firstDistances.get(first) || 0) - (firstDistances.get(second) || 0))[0];
  if (!firstSite || !secondSite) throw new Error(`${id}: no two accessible bomb sites with 36 metres of separation`);
  const sites = [{ ...firstSite, name: 'A' }, { ...secondSite, name: 'B' }];
  const metadata: ImportedMapMetadata = { name: names[id] || id, assetId: id, transform: transform.toArray(), bounds: [...bounds.min.toArray(), ...bounds.max.toArray()], cell, navigation: connected.map(point => ({ x: point.x, y: Number(point.y.toFixed(4)), z: point.z })), spawns, sites, triangles: indices.length / 3, surfaces: collisionSurfaces, triangleSurfaces };
  await writeFile(new URL(`${id}.collision.bin`, directory), encodeMapGeometry(vertices, triangles, metadata)); levels[id] = { ...metadata, navigation: [], triangleSurfaces: undefined };
  console.log(`${id}: ${metadata.triangles} triangles, ${metadata.navigation.length} connected navigation cells, ${spawns.T.length + spawns.CT.length} spawns`);
  geometry.dispose();
}
await writeFile(new URL('../shared/imported-maps.json', import.meta.url), `${JSON.stringify(levels)}\n`);