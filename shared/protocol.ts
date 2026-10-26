import { WEAPONS, type Input, type Player } from './game.ts';
import type { HitboxPose } from './combat.ts';

const signature = 0x4253;
const headerBytes = 12;
const inputBytes = 17;
const weaponIds = Object.keys(WEAPONS) as (keyof typeof WEAPONS)[];
const actions = ['jump', 'fire', 'crouch', 'sprint', 'reload', 'scope', 'interact'] as const;
export const SERVER_TICK_RATE = 64;
export const SNAPSHOT_RATE = 20;

export function encodeInputs(inputs: Input[]) {
  if (!inputs.length || inputs.length > 6) throw new Error('Input batches must contain one to six commands');
  const bytes = new Uint8Array(headerBytes + inputBytes * inputs.length); const view = new DataView(bytes.buffer);
  const baseTime = Math.floor(inputs[0].time);
  view.setUint16(0, signature, true); view.setUint8(2, 1); view.setUint8(3, inputs.length); view.setFloat64(4, baseTime, true);
  for (const [index, input] of inputs.entries()) {
    const offset = headerBytes + index * inputBytes; const weapon = weaponIds.indexOf(input.weapon);
    if (!Number.isSafeInteger(input.seq) || input.seq < 0 || input.seq > 0xffffffff || ![input.time, input.forward, input.side, input.yaw, input.pitch].every(Number.isFinite) || weapon < 0 || input.time < baseTime || input.time - baseTime > 1000) throw new Error('Invalid input command');
    const yaw = Math.atan2(Math.sin(input.yaw), Math.cos(input.yaw));
    view.setUint32(offset, input.seq, true); view.setUint32(offset + 4, Math.round((input.time - baseTime) * 1000), true);
    view.setInt16(offset + 8, Math.round(yaw / Math.PI * 32767), true); view.setInt16(offset + 10, Math.round(Math.max(-1.5, Math.min(1.5, input.pitch)) / 1.5 * 32767), true);
    view.setInt8(offset + 12, Math.round(Math.max(-1, Math.min(1, input.forward)) * 127)); view.setInt8(offset + 13, Math.round(Math.max(-1, Math.min(1, input.side)) * 127));
    view.setUint16(offset + 14, actions.reduce((mask, action, bit) => mask | (action !== 'sprint' && input[action] ? 1 << bit : 0), 0), true); view.setUint8(offset + 16, weapon);
  }
  return bytes;
}

export function decodeInputs(bytes: Uint8Array): Input[] {
  if (bytes.byteLength < headerBytes) throw new Error('Truncated input packet');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const count = view.getUint8(3); const baseTime = view.getFloat64(4, true);
  if (view.getUint16(0, true) !== signature || view.getUint8(2) !== 1 || count < 1 || count > 6 || bytes.byteLength !== headerBytes + inputBytes * count || !Number.isFinite(baseTime)) throw new Error('Invalid input packet');
  return Array.from({ length: count }, (_, index) => {
    const offset = headerBytes + index * inputBytes; const mask = view.getUint16(offset + 14, true); const weapon = weaponIds[view.getUint8(offset + 16)]; const microseconds = view.getUint32(offset + 4, true);
    if (!weapon || mask > 127 || microseconds > 1000000) throw new Error('Invalid input fields');
    return { seq: view.getUint32(offset, true), time: baseTime + microseconds / 1000, yaw: view.getInt16(offset + 8, true) / 32767 * Math.PI, pitch: view.getInt16(offset + 10, true) / 32767 * 1.5,
      forward: view.getInt8(offset + 12) / 127, side: view.getInt8(offset + 13) / 127, weapon,
      jump: !!(mask & 1), fire: !!(mask & 2), crouch: !!(mask & 4), sprint: false, reload: !!(mask & 16), scope: !!(mask & 32), interact: !!(mask & 64) };
  });
}

type HistoryFrame = { time: number; players: Map<string, HitboxPose> };
export class HitboxHistory {
  private frames: (HistoryFrame | undefined)[];
  private cursor = 0;
  private size = 0;
  constructor(private capacity = SERVER_TICK_RATE + 8) { this.frames = new Array(capacity); }
  clear() { this.frames.fill(undefined); this.cursor = 0; this.size = 0; }
  push(time: number, players: Player[]) {
    const poses = new Map(players.filter(player => player.hp > 0).map(player => [player.id, { x: player.x, y: player.y, z: player.z, crouch: player.crouch, deaths: player.deaths }]));
    this.frames[this.cursor] = { time, players: poses }; this.cursor = (this.cursor + 1) % this.capacity; this.size = Math.min(this.capacity, this.size + 1);
  }
  sample(time: number) {
    const result = new Map<string, HitboxPose>();
    if (!this.size) return result;
    let before: HistoryFrame | undefined; let after: HistoryFrame | undefined;
    for (let offset = 0; offset < this.size; offset++) {
      const frame = this.frames[(this.cursor - this.size + offset + this.capacity) % this.capacity]!;
      if (frame.time <= time) before = frame;
      if (frame.time >= time) { after = frame; break; }
    }
    before ||= after; after ||= before;
    if (!before || !after) return result;
    const blend = Math.max(0, Math.min(1, (time - before.time) / Math.max(0.001, after.time - before.time)));
    for (const [id, pose] of before.players) {
      const next = after.players.get(id);
      if (!next || next.deaths !== pose.deaths) continue;
      if (Math.hypot(next.x - pose.x, next.y - pose.y, next.z - pose.z) > 4) { result.set(id, next); continue; }
      result.set(id, { x: pose.x + (next.x - pose.x) * blend, y: pose.y + (next.y - pose.y) * blend, z: pose.z + (next.z - pose.z) * blend, crouch: blend < 0.5 ? pose.crouch : next.crouch, deaths: pose.deaths });
    }
    return result;
  }
}