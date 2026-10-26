import { Box3, BufferAttribute, BufferGeometry, DoubleSide, Line3, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { Player, Vec } from './game.ts';

export type SurfaceMaterial = 'wood' | 'drywall' | 'concrete' | 'steel' | 'glass';
export type ImportedMapMetadata = {
  name: string; assetId: string; transform: number[]; bounds: number[]; cell: number;
  navigation: Vec[]; spawns: { T: Vec[]; CT: Vec[] }; sites: (Vec & { name: string })[]; triangles: number;
  surfaces?: SurfaceMaterial[]; triangleSurfaces?: number[];
};
type MapGeometry = { geometry: BufferGeometry; bvh: MeshBVH; metadata: ImportedMapMetadata; cells: Map<string, Vec> };
const maps = new Map<string, MapGeometry>();
const lastGround = new WeakMap<Player, Vec>();
const magic = 0x42534d50;

export function encodeMapGeometry(positions: Float32Array, indices: Uint32Array, metadata: ImportedMapMetadata) {
  const text = new TextEncoder().encode(JSON.stringify(metadata)); const aligned = Math.ceil(text.length / 4) * 4;
  const result = new Uint8Array(16 + aligned + positions.byteLength + indices.byteLength); const header = new DataView(result.buffer);
  header.setUint32(0, magic, true); header.setUint32(4, text.length, true); header.setUint32(8, positions.length, true); header.setUint32(12, indices.length, true);
  result.set(text, 16); result.set(new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength), 16 + aligned); result.set(new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength), 16 + aligned + positions.byteLength);
  return result;
}

export function registerMapGeometry(id: string, bytes: Uint8Array | ArrayBuffer) {
  if (maps.has(id)) return maps.get(id)!;
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); const header = new DataView(source.buffer, source.byteOffset, source.byteLength);
  if (header.getUint32(0, true) !== magic) throw new Error('Invalid level collision file');
  const textLength = header.getUint32(4, true); const positionLength = header.getUint32(8, true); const indexLength = header.getUint32(12, true); const offset = 16 + Math.ceil(textLength / 4) * 4;
  if (offset + positionLength * 4 + indexLength * 4 !== source.byteLength) throw new Error('Truncated level collision file');
  const metadata: ImportedMapMetadata = JSON.parse(new TextDecoder().decode(source.subarray(16, 16 + textLength)));
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(source.buffer.slice(source.byteOffset + offset, source.byteOffset + offset + positionLength * 4)), 3));
  geometry.setIndex(new BufferAttribute(new Uint32Array(source.buffer.slice(source.byteOffset + offset + positionLength * 4, source.byteOffset + source.byteLength)), 1));
  const bvh = new MeshBVH(geometry, { targetLeafSize: 12, indirect: true });
  const cells = new Map(metadata.navigation.map(point => [`${Math.round(point.x / metadata.cell)},${Math.round(point.z / metadata.cell)}`, point]));
  const result = { geometry, bvh, metadata, cells }; maps.set(id, result); return result;
}

export function mapGeometry(id: string) { return maps.get(id); }
export function mapCell(id: string, x: number, z: number) {
  const map = maps.get(id); return map?.cells.get(`${Math.round(x / map.metadata.cell)},${Math.round(z / map.metadata.cell)}`);
}

export function capsuleClear(bvh: MeshBVH, feet: Vec, height = 1.8, radius = 0.31) {
  const segment = new Line3(new Vector3(feet.x, feet.y + radius + 0.006, feet.z), new Vector3(feet.x, feet.y + height - radius, feet.z));
  const bounds = new Box3().setFromPoints([segment.start, segment.end]).expandByScalar(radius);
  const trianglePoint = new Vector3(); const capsulePoint = new Vector3(); let clear = true;
  bvh.shapecast({ intersectsBounds: box => box.intersectsBox(bounds), intersectsTriangle: triangle => {
    if (triangle.closestPointToSegment(segment, trianglePoint, capsulePoint) < radius - 0.003) { clear = false; return true; }
    return false;
  } });
  return clear;
}

export function importedRayHit(id: string, ray: Ray, range: number) { return maps.get(id)?.bvh.raycastFirst(ray, DoubleSide, 0, range)?.distance ?? range; }

export function spawnGroup(bvh: MeshBVH, candidates: Vec[], anchor: Vec, count = 6) {
  const centers = [...candidates].sort((first, second) => Math.hypot(first.x - anchor.x, first.z - anchor.z) - Math.hypot(second.x - anchor.x, second.z - anchor.z));
  for (const center of centers.slice(0, 160)) {
    const nearby = candidates.filter(point => Math.abs(point.y - center.y) < 0.45 && Math.hypot(point.x - center.x, point.z - center.z) <= 4.5 && capsuleClear(bvh, point, 1.8, 0.65) && walkLink(bvh, center, point));
    const selected = [center];
    while (selected.length < count) {
      const next = nearby.filter(point => selected.every(other => Math.hypot(point.x - other.x, point.z - other.z) >= 1.5)).sort((first, second) => Math.hypot(first.x - center.x, first.z - center.z) - Math.hypot(second.x - center.x, second.z - center.z))[0];
      if (!next) break;
      selected.push(next);
    }
    if (selected.length === count) return selected;
  }
  return [];
}

export function walkLink(bvh: MeshBVH, from: Vec, to: Vec) {
  if (Math.abs(from.y - to.y) > 1.1) return false;
  const steps = Math.max(2, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.4));
  for (let step = 1; step < steps; step++) {
    const progress = step / steps; const point = { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress, z: from.z + (to.z - from.z) * progress };
    const hit = bvh.raycastFirst(new Ray(new Vector3(point.x, point.y + 0.45, point.z), new Vector3(0, -1, 0)), DoubleSide, 0, 0.9);
    if (!hit || !capsuleClear(bvh, { ...point, y: hit.point.y + 0.004 }, 1.8, 0.3)) return false;
  }
  return true;
}

export function moveOnImportedMap(id: string, player: Player, delta: Vec, height: number) {
  const map = maps.get(id); if (!map) return false;
  const radius = 0.29; const next = new Vector3(player.x + delta.x, player.y + delta.y, player.z + delta.z);
  if (player.grounded && delta.y <= 0 && (delta.x || delta.z)) {
    const step = map.bvh.raycastFirst(new Ray(new Vector3(next.x, player.y + 0.36, next.z), new Vector3(0, -1, 0)), DoubleSide, 0, 0.45);
    if (step && step.point.y > player.y + 0.01 && capsuleClear(map.bvh, { x: next.x, y: step.point.y + 0.004, z: next.z }, height, radius)) next.y = step.point.y + 0.004;
  }
  const segment = new Line3(new Vector3(next.x, next.y + radius, next.z), new Vector3(next.x, next.y + height - radius, next.z));
  const bounds = new Box3(); const trianglePoint = new Vector3(); const capsulePoint = new Vector3(); let grounded = false;
  for (let iteration = 0; iteration < 3; iteration++) {
    bounds.setFromPoints([segment.start, segment.end]).expandByScalar(radius);
    map.bvh.shapecast({ intersectsBounds: box => box.intersectsBox(bounds), intersectsTriangle: triangle => {
      const distance = triangle.closestPointToSegment(segment, trianglePoint, capsulePoint);
      if (distance >= radius - 0.00001) return false;
      const correction = capsulePoint.sub(trianglePoint);
      if (correction.lengthSq() < 1e-10) triangle.getNormal(correction);
      correction.normalize().multiplyScalar(radius - distance + 0.00001);
      if (correction.y > 0.0005 && player.vy <= 0) grounded = true;
      if (correction.y < -0.0005 && player.vy > 0) player.vy = 0;
      segment.start.add(correction); segment.end.add(correction); return false;
    } });
  }
  player.x = segment.start.x; player.y = segment.start.y - radius; player.z = segment.start.z;
  player.grounded = grounded; if (grounded) player.vy = 0;
  if (grounded && capsuleClear(map.bvh, player, height, radius)) lastGround.set(player, { x: player.x, y: player.y, z: player.z });
  const [minX, , minZ, maxX, , maxZ] = map.metadata.bounds;
  player.x = Math.max(minX + radius, Math.min(maxX - radius, player.x)); player.z = Math.max(minZ + radius, Math.min(maxZ - radius, player.z));
  const supported = player.vy < -7 ? map.bvh.raycastFirst(new Ray(new Vector3(player.x, player.y + 0.2, player.z), new Vector3(0, -1, 0)), DoubleSide, 0, 5) : true;
  if (player.y < map.metadata.bounds[1] - 5 || player.vy < -7 && !supported) {
    const safe = lastGround.get(player) || map.metadata.spawns[player.team][0]; Object.assign(player, safe, { vy: 0, grounded: true });
  }
  return true;
}