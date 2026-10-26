import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, 'model-imports');
const catalogPath = resolve(directory, 'sketchfab-downloads.json');
try { process.loadEnvFile(resolve(root, '.env.local')); } catch {}
const token = process.env.SKETCHFAB_ACCESS_TOKEN;
if (!token) throw new Error('Set SKETCHFAB_ACCESS_TOKEN in the ignored local environment file');
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
if (catalog.version !== 1 || !Array.isArray(catalog.models)) throw new Error('Invalid model catalog');
const additions = process.argv.filter(argument => argument.startsWith('--add=')).map(argument => argument.slice(6).split(':'));
const added = [];
for (const [uid, category] of additions) {
  if (!/^[a-f0-9]{32}$/.test(uid) || !['knives', 'weapons', 'maps'].includes(category)) throw new Error('Use --add=MODEL_UID:knives|weapons|maps');
  let record = catalog.models.find(record => record.uid === uid);
  if (!record) { record = { uid, id: `sf-${category === 'knives' ? 'knife' : category === 'maps' ? 'map' : 'weapon'}-${uid.slice(0, 8)}`, category, kind: category === 'maps' ? 'map' : category === 'weapons' ? 'viewmodel' : 'weapon', archive: `sketchfab-${uid}.zip`, downloaded: false }; catalog.models.push(record); }
  added.push(record.id);
}
const selected = process.argv.find(argument => argument.startsWith('--only='))?.slice(7).split(',') || (added.length ? added : undefined);
const maximumBytes = 100 * 1024 * 1024;
const save = () => writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

async function api(path) {
  const response = await fetch(`https://api.sketchfab.com/v3/${path}`, { headers: { Authorization: `Token ${token}` }, signal: AbortSignal.timeout(30000) });
  if (response.status === 429) throw new Error(`Sketchfab API HTTP 429; retry after ${response.headers.get('retry-after') || '60'} seconds`);
  if (!response.ok) throw new Error(`Sketchfab API HTTP ${response.status}`);
  return response.json();
}

async function archive(url, expected) {
  const address = new URL(url);
  if (address.protocol !== 'https:' || address.username || address.password || expected > maximumBytes) throw new Error('Unsupported archive URL or download size');
  const controller = new AbortController();
  const response = await fetch(address, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]) });
  if (!response.ok) throw new Error(`Archive HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > maximumBytes) { controller.abort(); throw new Error('Archive exceeds the size limit'); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maximumBytes) { controller.abort(); throw new Error('Archive exceeds the size limit'); }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.subarray(0, 4).toString() === 'glTF') return Buffer.from(zipSync({ 'scene.glb': bytes }));
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Expected a glTF ZIP archive');
  return bytes;
}

await mkdir(directory, { recursive: true });
for (const record of catalog.models.filter(record => !selected || selected.includes(record.id))) {
  if (!/^[a-z0-9-]+$/.test(record.id) || !/^[a-f0-9]{32}$/.test(record.uid) || basename(record.archive) !== record.archive || !record.archive.endsWith('.zip')) throw new Error('Invalid model catalog entry');
  try {
    const path = resolve(directory, record.archive);
    const cached = await stat(path).then(value => value.size > 0).catch(() => false);
    if (record.downloaded && cached) { console.log(JSON.stringify({ id: record.id, cached: true })); continue; }
    const model = await api(`models/${record.uid}`);
    if (!model.isDownloadable || !['by', 'cc0'].includes(model.license?.slug)) throw new Error('Model must be downloadable under CC BY or CC0');
    if (!cached) {
      const formats = await api(`models/${record.uid}/download`);
      const format = [formats.glb, formats.gltf].find(format => format?.url && (!format.size || format.size <= maximumBytes));
      if (!format) throw new Error('No glTF or GLB download within the size limit');
      const bytes = await archive(format.url, format.size || 0);
      await writeFile(path, bytes);
    }
    const source = model.viewerUrl || `https://sketchfab.com/3d-models/${record.uid}`;
    const credit = `${model.name}\nCreator: ${model.user.displayName || model.user.username}\nSource: ${source}\nLicense: ${model.license.fullName}\n${model.license.url}\nDownloaded using the official authenticated Sketchfab API.\nRuntime version may be optimized, normalized and assigned gameplay animations.\n`;
    await writeFile(resolve(directory, `${record.id}-license.txt`), credit);
    Object.assign(record, { name: model.name, source, author: model.user.displayName || model.user.username, license: { name: model.license.fullName, url: model.license.url, slug: model.license.slug }, animations: model.animationCount, downloaded: true, bytes: (await stat(path)).size });
    delete record.error; await save();
    console.log(JSON.stringify({ id: record.id, name: record.name, downloaded: !cached, cached, animations: record.animations, license: record.license.slug, megabytes: Number((record.bytes / 1048576).toFixed(2)) }));
  } catch (error) {
    record.error = /^(Sketchfab API HTTP|Archive HTTP|Model must|No glTF|Archive exceeds)/.test(error.message) ? error.message : 'Download unavailable or archive validation failed';
    await save(); console.error(`${record.id}: ${record.error}`); process.exitCode = 1;
    if (record.error.startsWith('Sketchfab API HTTP 429')) break;
  }
}