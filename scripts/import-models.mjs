import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname, extname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createExtractorFromData } from 'node-unrar-js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, metalRough, prune, resample, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const input = resolve(root, 'model-imports');
const output = resolve(root, 'client/public/models/imported');
const scratch = resolve(root, 'node_modules/.cache/browserstrike-imports');
const inspect = process.argv.includes('--inspect');
const selected = process.argv.find(argument => argument.startsWith('--only='))?.slice(7).split(',');
const sources = [
  ['ak47', 'rifle-ak-47-weapon-model-cs2.zip', 'weapon'],
  ['m4a4', 'rifle-m4a4-weapon-model-cs2.zip', 'weapon'],
  ['m4a1s', 'm4a1-s-cs2-first-person-animations.zip', 'viewmodel'],
  ['awp', 'rifle-awp-black-version-weapon-model-cs2.zip', 'weapon'],
  ['usp', 'pistol-usp-s-weapon-model-cs2.zip', 'weapon'],
  ['deagle', 'pistol-desert-eagle-weapon-model-cs2.zip', 'weapon'],
  ['handcannon-classic', 'desert_eagle_animated.zip', 'viewmodel'],
  ['deagle-view', 'desert_eagle__first_person_animations.zip', 'viewmodel'],
  ['ak-view', 'ak-47_with_arms_and_shoot_animation.zip', 'viewmodel'],
  ['outpost', 'counter_strike_map.zip', 'map'],
  ['aug', 'aug_counter_strike_2.zip', 'weapon'],
  ['bizon', 'bizon_counter_strike_2.zip', 'weapon'],
  ['cz75', 'cz75a_counter_strike_2.zip', 'weapon'],
  ['g3sg1', 'g3sg1_counter_strike_2.zip', 'weapon'],
  ['mp5', 'mp5sd_counter_strike_2.zip', 'weapon'],
  ['mp7', 'mp7_counter_strike_2.zip', 'weapon'],
  ['negev', 'negev_counter_strike_2.zip', 'weapon'],
  ['karambit', 'cs2_kerambit.glb', 'weapon'],
  ['gloves', 'cs_go_karambit_with_sport_gloves.zip', 'viewmodel'],
  ['knife', 'knife_cs_1_6_fbx_port.zip', 'weapon'],
  ['kunai', 'kunai_luxury_standoff_2.zip', 'weapon'],
  ['ak-tag', 'akr_tag_king__standoff_2.zip', 'weapon'],
  ['sas', 'sas-cs2-agent-model-blue.zip', 'character'],
  ['sas-red', 'sas-cs2-agent-model-red.zip', 'character'],
  ['robot', 'robot-expressive.glb', 'character'],
  ['operator-animations', 'all_characteranimation.zip', 'character'],
  ['ak74u', 'ak74u__free_animation..zip', 'weapon'],
  ['akm', 'akm_assault_rifle_-_animated.zip', 'weapon'],
  ['m16a2', 'm16_a2_assault_rifle_-_animated.zip', 'weapon'],
  ['scar', 'scar.zip', 'weapon'],
  ['scorpion', 'scorpion__first_person_animations_2026_remake.zip', 'viewmodel'],
  ['fennec', 'mw_2019_fennec_vipers_gmod_mw_base.zip', 'weapon'],
  ['remington870', 'remington_870_shotgun_-_animated.zip', 'weapon'],
  ['cs5', 'weapon_mcmillan_cs5_sniper_rifle_free_downloads.zip', 'weapon'],
  ['precision-sniper', 'sniper_fps_animation.zip', 'viewmodel'],
  ['hk416', 'hk_416_a7_fps_animation.zip', 'viewmodel'],
  ['benelli', 'fps_benelli_m4_animations.zip', 'viewmodel'],
  ['butterfly-fps', 'fps_butterfly_knife.zip', 'viewmodel'],
  ['pistol-fps', 'fps_pistol_animations.zip', 'viewmodel'],
  ['aug-animated', 'steyr_aug_a1_assault_rifle_-_animated.zip', 'weapon'],
  ['slr', 'l1a1_slr_-_animated.zip', 'weapon'],
  ['knife-animated', 'animated_knife.zip', 'weapon'],
  ['knife-flip', 'knife_animated.zip', 'weapon'],
  ['c4', 'bomb-c4-explosive-model-cs2.zip', 'prop'],
  ['kit', 'defuse-defuse-kit-model-cs2.zip', 'prop'],
  ['case', 'csgo_case.zip', 'prop'],
  ['dream-case', 'dreams__nightmares__csgo_box.zip', 'prop'],
  ['flashbang', 'flashbang.zip', 'prop'],
  ['grenade', 'grenade.zip', 'prop'],
  ['arena', 'arena-standoff-2.zip', 'map'],
  ['breeze', 'breeze-standoff-2.zip', 'map'],
  ['dune', 'dune.zip', 'map'],
  ['dust2', 'dust-2-cs-16.zip', 'map'],
  ['rust', 'rust.zip', 'map'],
  ['sandstone', 'sendstone-new.zip', 'map'],
  ['zona7', 'zona7.zip', 'map'],
  ['collection', 'maps.zip', 'map'],
  ['resoforge', 'lowpoly-map-asset-by-resoforge.zip', 'map'],
];

function safePath(name) {
  const normalized = name.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.split('/').includes('..')) throw new Error(`Unsafe archive path: ${name}`);
  return normalized;
}

async function unpack(data, extension, destination, depth = 0) {
  if (depth > 3) throw new Error('Archive nesting limit exceeded');
  let entries;
  if (extension === '.rar') {
    const extractor = await createExtractorFromData({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) });
    entries = [...extractor.extract().files].filter(file => !file.fileHeader.flags.directory).map(file => [file.fileHeader.name, file.extraction]);
  } else entries = Object.entries(unzipSync(data));
  const files = [];
  for (const [name, content] of entries) {
    if (!content || name.endsWith('/')) continue;
    const path = safePath(name); const extension = extname(path).toLowerCase();
    if (['.zip', '.rar'].includes(extension)) { files.push(...await unpack(content, extension, resolve(destination, `${path}.unpacked`), depth + 1)); continue; }
    if (!/\.(gltf|glb|bin|fbx|blend|png|jpe?g|webp|tga|bmp|ktx2|txt|md)$/i.test(path)) continue;
    const target = resolve(destination, path);
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, content); files.push(target);
  }
  return files;
}

function jsonFrom(data, extension) {
  if (extension === '.gltf') return JSON.parse(data.toString());
  const length = data.readUInt32LE(12); return JSON.parse(data.subarray(20, 20 + length).toString());
}

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const manifest = inspect ? {} : JSON.parse(await readFile(resolve(output, 'manifest.json'), 'utf8').catch(() => '{}'));
for (const [id, archive, kind] of sources.filter(([id]) => !selected || selected.includes(id))) {
  const source = resolve(input, archive);
  try {
    const destination = resolve(scratch, id); await mkdir(destination, { recursive: true });
    const bytes = await readFile(source);
    const files = extname(source) === '.glb' ? [source] : await unpack(bytes, extname(source), destination);
    const candidates = files.filter(file => /\.(gltf|glb)$/i.test(file));
    const licenses = files.filter(file => /license|readme|credit/i.test(basename(file)));
    if (!candidates.length) { console.log(JSON.stringify({ id, kind, status: 'conversion-needed', files: files.filter(file => /\.(fbx|blend)$/i.test(file)).map(file => relative(destination, file)) })); continue; }
    const model = candidates.find(file => /scene\.gltf$/i.test(file)) || candidates[0];
    const json = jsonFrom(await readFile(model), extname(model));
    const summary = { id, kind, meshes: json.meshes?.length || 0, materials: json.materials?.length || 0, skins: json.skins?.length || 0, clipCount: json.animations?.length || 0, clips: json.animations?.slice(0, 12).map(clip => clip.name || 'unnamed') || [], nodes: json.nodes?.slice(0, 12).map(node => node.name) || [], license: licenses.length > 0, megabytes: Number(((await stat(model)).size / 1048576).toFixed(2)) };
    if (inspect) { console.log(JSON.stringify(summary)); continue; }
    const document = await io.read(model);
    if (['handcannon-classic', 'benelli', 'pistol-fps'].includes(id)) await document.transform(metalRough());
    const animations = document.getRoot().listAnimations();
    if (kind === 'character') {
      const useful = animations.filter(animation => /idle|walk|run|crouch|death|reload|shoot|strafe|jump/i.test(animation.getName()));
      const retained = useful.length ? useful : [animations.find(animation => /^eye_test_sas blue$/i.test(animation.getName())) || animations[0]];
      animations.filter(animation => !retained.includes(animation)).forEach(animation => animation.dispose());
    } else if (kind === 'weapon') {
      const useful = animations.filter(animation => /^(firstperson_(draw|idle|reload|lookat01|shoot1|stab|slash|attack)|idle|draw(_first)?|take|equip(_start)?|reload(_empty|[12])?|inspect|inspec|shoot|fire[12]?|attack|melee_hit_0[123])$/i.test(animation.getName().split('|').at(-1).replace(/^MM_CS5_/i, '')));
      if (useful.length) animations.filter(animation => !useful.includes(animation)).forEach(animation => animation.dispose());
    }
    if (id === 'm4a1s') for (const scene of document.getRoot().listScenes()) for (const node of scene.listChildren()) if (/^WGT-/i.test(node.getName())) node.dispose();
    await document.transform(resample(), dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 85 }));
    if (id === 'cs5') await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
    await mkdir(output, { recursive: true }); const target = resolve(output, `${id}.glb`); await io.write(target, document);
    const sidecar = await readFile(resolve(input, `${id}-license.txt`), 'utf8').catch(() => '');
    const credits = [...await Promise.all(licenses.map(file => readFile(file, 'utf8'))), sidecar].filter(Boolean).join('\n\n');
    if (credits) await writeFile(resolve(output, `${id}-license.txt`), credits);
    manifest[id] = { url: `/models/imported/${id}.glb`, kind, source: archive, bytes: (await stat(target)).size, clips: document.getRoot().listAnimations().map(animation => animation.getName()), license: credits ? `/models/imported/${id}-license.txt` : null, attribution: credits || 'User-supplied archive. No license text was included; verify redistribution rights before public deployment.' };
    console.log(JSON.stringify({ ...summary, outputMB: Number((manifest[id].bytes / 1048576).toFixed(2)) }));
    await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) { console.error(`${id}: ${error.message}`); process.exitCode = 1; }
}
if (!inspect) {
  const credits = ['# Imported Model Credits', '', 'These are user-supplied downloads, not original BROWSERSTRIKE assets. Included license text is preserved below. Missing license text is not permission to redistribute.', ''];
  for (const [id, asset] of Object.entries(manifest)) credits.push(`## ${id}`, '', `Archive: ${asset.source}`, '', asset.attribution, '');
  await writeFile(resolve(root, 'MODEL-CREDITS.md'), credits.join('\n'));
}