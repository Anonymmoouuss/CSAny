import { WEAPONS, type GameEvent, type Mode, type Team, type WeaponId } from './game.ts';

export function creditReward(mode: Mode, offline: boolean, event: GameEvent, team?: Team) {
  if (mode === 'training') return event.type === 'kill' ? 5 : 0;
  if (offline && mode !== 'elimination') return 0;
  if (event.type === 'kill') return 250;
  if (event.type === 'round') return event.team === team ? 1200 : 450;
  if (event.type === 'bomb') return event.text === 'Bomb planted' ? 350 : event.text === 'Bomb defused' ? 500 : 0;
  return 0;
}

export type Pattern = 'solid' | 'fade' | 'camo' | 'hydro' | 'hardened' | 'tiger' | 'doppler' | 'marble' | 'slaughter' | 'circuit' | 'glyph' | 'topographic' | 'shards' | 'chromatic' | 'aurora' | 'ceramic';
export type KnifeKind = 'karambit' | 'butterfly' | 'bayonet' | 'huntsman' | 'flip';
export type SkinDefinition = { id: string; name: string; weapon: WeaponId; knife?: KnifeKind; asset?: string; pattern: Pattern; colors: string[]; seed: number; rarity: number; wrap: boolean };
export type CharmId = 'field-tag' | 'lucky-die' | 'cartridge' | 'signal-gem' | 'mini-blade' | `collectible-${number}-${number}`;
export type CharmShape = 'tag' | 'die' | 'cartridge' | 'gem' | 'blade' | 'star' | 'shield' | 'ring' | 'bolt' | 'pyramid' | 'capsule' | 'beacon' | 'skull' | 'wing' | 'hex' | 'crown' | 'rocket' | 'key' | 'crescent' | 'diamond';
export type CharmDefinition = { id: CharmId; name: string; color: string; accent: string; shape: CharmShape; rarity: number; seed: number };
const charmForms: readonly [string, CharmShape][] = [
  ['Operator Tag', 'tag'], ['Loaded Dice', 'die'], ['Last Cartridge', 'cartridge'], ['Astral Crystal', 'gem'], ['Pocket Blade', 'blade'],
  ['North Star', 'star'], ['Vanguard Crest', 'shield'], ['Orbital Ring', 'ring'], ['Thunderbolt', 'bolt'], ['Ancient Pyramid', 'pyramid'],
  ['Escape Capsule', 'capsule'], ['Signal Beacon', 'beacon'], ['Phantom Skull', 'skull'], ['Silver Wing', 'wing'], ['Hex Core', 'hex'],
  ['Victory Crown', 'crown'], ['Micro Rocket', 'rocket'], ['Vault Key', 'key'], ['Lunar Crescent', 'crescent'], ['Crown Jewel', 'diamond'],
];
const charmFinishes: readonly [string, string, string][] = [
  ['Cobalt', '#3275db', '#d5eaff'], ['Ruby', '#d9425c', '#ffd69c'], ['Emerald', '#35b77e', '#e3ef9a'], ['Gold', '#e1b947', '#584530'],
  ['Obsidian', '#31343e', '#d6a5f1'], ['Arctic', '#bce6ed', '#326e9e'], ['Coral', '#f07a70', '#d9f5d5'], ['Jade', '#3d9d8d', '#e2cd8c'],
  ['Neon', '#d4ed46', '#224d5f'], ['Candy', '#e76ba6', '#86e2dc'], ['Porcelain', '#e8e9e4', '#24629b'], ['Copper', '#bd7e52', '#ccead9'],
  ['Solar', '#ed9e37', '#b6e8d5'], ['Violet', '#a878d4', '#eedca2'], ['Glacier', '#61bfd0', '#f0f4e9'], ['Crimson', '#9d2d47', '#f6d5cd'],
];
export const CHARMS: CharmDefinition[] = [
  { id: 'field-tag', name: 'Field Tag', color: '#9cad9d', accent: '#dce8cb', shape: 'tag', rarity: 0, seed: 1 },
  { id: 'lucky-die', name: 'Lucky Die', color: '#e4c062', accent: '#2d3838', shape: 'die', rarity: 1, seed: 2 },
  { id: 'cartridge', name: 'Brass Cartridge', color: '#c7a059', accent: '#66514a', shape: 'cartridge', rarity: 1, seed: 3 },
  { id: 'signal-gem', name: 'Signal Gem', color: '#5ac9bc', accent: '#e4f0cb', shape: 'gem', rarity: 3, seed: 4 },
  { id: 'mini-blade', name: 'Pocket Blade', color: '#cc778a', accent: '#dce9e9', shape: 'blade', rarity: 3, seed: 5 },
  ...charmForms.flatMap(([name, shape], form) => charmFinishes.map(([finish, color, accent], variant) => ({ id: `collectible-${form}-${variant}` as CharmId, name: `${name} / ${finish}`, color, accent, shape, rarity: (form + variant) % 6, seed: 11003 + form * 1877 + variant * 271 }))),
];
export const CHARM_BY_ID = new Map(CHARMS.map(charm => [charm.id, charm]));
export type SkinAppearance = { skinId: string; seed: number; float: number; statTrak: boolean; kills: number; charm?: CharmId };
export type InventoryItem = SkinAppearance & { uid: string; acquiredAt: number };
export type Statistics = { kills: number; deaths: number; headshots: number; shots: number; hits: number; wins: number; rounds: number; planted: number; defused: number; weapons: Partial<Record<WeaponId, number>> };
export type Profile = { version: 2; credits: number; items: InventoryItem[]; equipped: Partial<Record<WeaponId, string>>; cases: Record<string, number>; keys: number; unlockedCharms?: CharmId[]; stats: Statistics };

export const RARITIES = [
  { name: 'Consumer', color: '#c7ced2', weight: 38, value: 60 },
  { name: 'Industrial', color: '#8dbbe6', weight: 29, value: 150 },
  { name: 'Mil-Spec', color: '#537bfa', weight: 20, value: 420 },
  { name: 'Restricted', color: '#a580f5', weight: 8, value: 1100 },
  { name: 'Classified', color: '#e56bb8', weight: 3.5, value: 3400 },
  { name: 'Covert', color: '#f06565', weight: 1, value: 9000 },
  { name: 'Rare Special', color: '#e9bd60', weight: 0.5, value: 26000 },
] as const;
export const KNIFE_KINDS: KnifeKind[] = ['karambit', 'butterfly', 'bayonet', 'huntsman', 'flip'];
const finishes: { name: string; pattern: Pattern; colors: string[]; rarity: number; wrap?: boolean }[] = [
  { name: 'Field Issue', pattern: 'solid', colors: ['#465754', '#242d2b', '#9aa498'], rarity: 0 },
  { name: 'Chalk Line', pattern: 'solid', colors: ['#deded6', '#6a7476', '#24292d'], rarity: 0 },
  { name: 'Tidal Grid', pattern: 'camo', colors: ['#5c9fa3', '#24464f', '#d0e5d3'], rarity: 1, wrap: true },
  { name: 'Desert Signal', pattern: 'camo', colors: ['#c4a06c', '#4d5146', '#d8d4ad'], rarity: 1 },
  { name: 'Redline Circuit', pattern: 'hydro', colors: ['#232b30', '#df4b50', '#b1b9bb'], rarity: 2, wrap: true },
  { name: 'Ultraviolet Current', pattern: 'hydro', colors: ['#292844', '#9485d9', '#dfc8ef'], rarity: 2, wrap: true },
  { name: 'Rainforest', pattern: 'camo', colors: ['#203e35', '#70a674', '#bac283'], rarity: 2 },
  { name: 'Arctic Digital', pattern: 'camo', colors: ['#d6e6e8', '#66848c', '#343e54'], rarity: 2, wrap: true },
  { name: 'Tiger Tooth', pattern: 'tiger', colors: ['#eab747', '#533618', '#ffdc85'], rarity: 3 },
  { name: 'Prism Fade', pattern: 'fade', colors: ['#f5b745', '#df5f98', '#6a85ef'], rarity: 3 },
  { name: 'Blue Temper', pattern: 'hardened', colors: ['#ceac59', '#3664aa', '#a279bf'], rarity: 3 },
  { name: 'Slaughter', pattern: 'slaughter', colors: ['#a9233d', '#ef6b74', '#452530'], rarity: 3, wrap: true },
  { name: 'Doppler / Ion', pattern: 'doppler', colors: ['#14242c', '#25a8bf', '#7444b8'], rarity: 4 },
  { name: 'Doppler / Ruby', pattern: 'doppler', colors: ['#240f23', '#ed3355', '#953a7c'], rarity: 4 },
  { name: 'Marble Fade', pattern: 'marble', colors: ['#ffce61', '#ed5964', '#4b99df'], rarity: 4 },
  { name: 'Aurora Bloom', pattern: 'doppler', colors: ['#284d57', '#7ae2c0', '#eaa4cc'], rarity: 5, wrap: true },
  { name: 'Solar Flare', pattern: 'hydro', colors: ['#d45539', '#ffdf77', '#2d3a4c'], rarity: 5, wrap: true },
  { name: 'Ocean Relic', pattern: 'hardened', colors: ['#325c94', '#70d7d4', '#d6b663'], rarity: 5 },
];
const firearmIds = (Object.keys(WEAPONS) as WeaponId[]).filter(id => id !== 'knife');
export const DEFAULT_KNIFE_ID = 'knife-field-karambit';
const colorways = [
  ['Verdigris', '#196d69', '#c8e16b', '#c5e9d9'], ['Cherry', '#a51b41', '#f4adbe', '#272d38'],
  ['Cobalt', '#235cc2', '#d3ebfa', '#f1bc59'], ['Graphite', '#343e46', '#bbc8cf', '#e26466'],
  ['Citrine', '#e5ba28', '#383d35', '#fff0a2'], ['Mint', '#5fc99a', '#193b38', '#e5f6dc'],
  ['Coral', '#e66c66', '#1c575f', '#ffe3ba'], ['Glacier', '#b9e7ef', '#336c94', '#ffffff'],
  ['Crimson', '#bc2131', '#341f2d', '#fbc4a6'], ['Orchid', '#b655aa', '#264b54', '#efcadf'],
  ['Limewire', '#a7d43c', '#1c3c39', '#eaf6b4'], ['Petrol', '#177e96', '#153244', '#e8b951'],
  ['Porcelain', '#e7e7e4', '#244d83', '#ce4d5a'], ['Rosegold', '#d5a0a1', '#53505d', '#f2d4ba'],
  ['Signal', '#ec5742', '#292f35', '#f8edc4'], ['Seaglass', '#71c5bc', '#365771', '#d8f0d2'],
  ['Vermilion', '#c94831', '#f5c85a', '#493c4d'], ['Steelblue', '#779cbd', '#202f40', '#d3e7e7'],
  ['Jade', '#2b9063', '#d4d66c', '#143c38'], ['Obsidian', '#25252e', '#c7cdd6', '#8bcae4'],
  ['Saffron', '#f0bd53', '#305363', '#ee6f61'], ['Cerise', '#dc4d82', '#252f47', '#c9e5d0'],
  ['Aquamarine', '#40b7c3', '#264365', '#e8d68a'], ['Ivory', '#f0eadc', '#3d6b65', '#c44d5c'],
  ['Fern', '#6a9b5d', '#223c38', '#decc81'], ['Burgundy', '#732c4b', '#dcb39b', '#a4c5d1'],
  ['Ultramarine', '#374dbe', '#65cbc9', '#f1d2bd'], ['Quicksilver', '#bdc5cb', '#424d59', '#66c6b0'],
] as const;
function blendColor(first: string, second: string) {
  return `#${[1, 3, 5].map(offset => Math.round(parseInt(first.slice(offset, offset + 2), 16) * 0.2 + parseInt(second.slice(offset, offset + 2), 16) * 0.8).toString(16).padStart(2, '0')).join('')}`;
}
export const SKIN_CATALOG: SkinDefinition[] = [
  ...firearmIds.flatMap((weapon, index) => finishes.map((finish, finishIndex) => ({
    id: `${weapon}-${finishIndex}`, name: finish.name, weapon, pattern: finish.pattern,
    colors: finish.colors, seed: 1709 + index * 7919 + finishIndex * 127, rarity: finish.rarity, wrap: !!finish.wrap,
  }))),
  ...KNIFE_KINDS.flatMap((knife, index) => finishes.slice(6).map((finish, finishIndex) => ({
    id: `knife-${knife}-${finishIndex}`, name: finish.name, weapon: 'knife' as const, knife,
    pattern: finish.pattern, colors: finish.colors, seed: 19001 + index * 701 + finishIndex * 97, rarity: 6, wrap: !!finish.wrap,
  }))),
  ...[...firearmIds, ...KNIFE_KINDS].flatMap((kind, kindIndex) => colorways.flatMap(([name, ...palette], colorIndex) => finishes.map((finish, finishIndex) => {
    const knife = KNIFE_KINDS.includes(kind as KnifeKind) ? kind as KnifeKind : undefined;
    return { id: `${knife ? `knife-${knife}` : kind}-c${colorIndex}-${finishIndex}`, name: `${name} / ${finish.name}`,
      weapon: knife ? 'knife' as const : kind as WeaponId, knife, pattern: finish.pattern,
      colors: finish.colors.map((color, index) => blendColor(color, palette[(index + finishIndex) % palette.length])),
      seed: 73001 + kindIndex * 7907 + colorIndex * 503 + finishIndex * 131, rarity: knife ? 6 : finish.rarity, wrap: !!finish.wrap };
  }))),
  ...[...firearmIds, ...KNIFE_KINDS].flatMap((kind, kindIndex) => colorways.flatMap(([name, ...palette], colorIndex) => (['circuit', 'glyph', 'topographic', 'shards', 'chromatic', 'aurora', 'ceramic'] as const).map((pattern, patternIndex) => {
    const knife = KNIFE_KINDS.includes(kind as KnifeKind) ? kind as KnifeKind : undefined;
    const titles = ['Quantum Circuit', 'Celestial Glyph', 'Contour Flux', 'Prismatic Fracture', 'Spectral Chrome', 'Polar Radiance', 'Porcelain Dragon'];
    return { id: `${knife ? `knife-${knife}` : kind}-signature-${pattern}-${colorIndex}`, name: `${name} / ${titles[patternIndex]}`, weapon: knife ? 'knife' as const : kind as WeaponId, knife, pattern,
      colors: [...palette], seed: 230009 + kindIndex * 10103 + colorIndex * 977 + patternIndex * 131, rarity: knife ? 6 : patternIndex % 3 + 3, wrap: true };
  }))),
  { id: DEFAULT_KNIFE_ID, name: 'Field Karambit', weapon: 'knife', knife: 'karambit', pattern: 'solid', colors: ['#b9c0c4', '#222c30', '#687781'], seed: 1, rarity: 0, wrap: false },
  { id: 'knife-archive', name: 'Archive Blade', weapon: 'knife', knife: 'huntsman', asset: 'knife', pattern: 'hardened', colors: ['#8a99ad', '#474e60', '#cfad71'], seed: 54017, rarity: 6, wrap: false },
  { id: 'knife-tactical-motion', name: 'Kinetic Edge', weapon: 'knife', knife: 'bayonet', asset: 'knife-animated', pattern: 'hydro', colors: ['#254b4c', '#76d8cc', '#f0c66a'], seed: 68521, rarity: 6, wrap: true },
  { id: 'knife-flip-motion', name: 'Orbit Flip', weapon: 'knife', knife: 'flip', asset: 'knife-flip', pattern: 'hardened', colors: ['#334e82', '#d4aa5a', '#73cabd'], seed: 68522, rarity: 6, wrap: false },
];
export const SKIN_BY_ID = new Map(SKIN_CATALOG.map(skin => [skin.id, skin]));
export type CaseDefinition = { id: string; name: string; tag: string; price: number; color: string; accent: string; knifeChance: number; weapons: WeaponId[]; knives: KnifeKind[] };
export const CASES: CaseDefinition[] = [
  { id: 'dust', name: 'DUST CASE', tag: 'DS / 01', price: 650, color: '#d1ac63', accent: '#e5664d', knifeChance: 0.005, weapons: ['rifle', 'pistol', 'smg', 'shotgun'], knives: ['karambit', 'bayonet'] },
  { id: 'neon', name: 'NEON CASE', tag: 'NE / 02', price: 1100, color: '#72cec3', accent: '#e97ba9', knifeChance: 0.012, weapons: ['vector', 'compactSmg', 'machinePistol', 'servicePistol', 'bullpup'], knives: ['butterfly', 'flip'] },
  { id: 'blade', name: 'BLADE CASE', tag: 'BL / 03', price: 2200, color: '#a8b0bc', accent: '#ecb44d', knifeChance: 0.04, weapons: [], knives: KNIFE_KINDS },
  { id: 'foundry', name: 'FOUNDRY CASE', tag: 'FD / 04', price: 900, color: '#a6aaa0', accent: '#ed7f64', knifeChance: 0.008, weapons: ['lmg', 'battleRifle', 'carbine', 'handCannon'], knives: ['bayonet', 'huntsman'] },
  { id: 'tide', name: 'TIDEBREAK CASE', tag: 'TD / 05', price: 850, color: '#6aa4ba', accent: '#d2e3c0', knifeChance: 0.008, weapons: ['sniper', 'scout', 'marksman', 'pistol'], knives: ['flip', 'bayonet'] },
  { id: 'palace', name: 'PALACE CASE', tag: 'PL / 06', price: 1250, color: '#b6bb7d', accent: '#f0c078', knifeChance: 0.015, weapons: ['rifle', 'handCannon', 'revolver', 'heavySniper'], knives: ['karambit', 'butterfly'] },
  { id: 'fracture', name: 'FRACTURE CASE', tag: 'FR / 07', price: 1500, color: '#bd777e', accent: '#b9e4c9', knifeChance: 0.018, weapons: ['autoShotgun', 'burstRifle', 'vector', 'carbine'], knives: ['huntsman', 'flip'] },
  { id: 'prism', name: 'PRISM CASE', tag: 'PR / 08', price: 1750, color: '#86a7cc', accent: '#f3c88a', knifeChance: 0.025, weapons: ['bullpup', 'machinePistol', 'marksman', 'servicePistol'], knives: ['butterfly', 'karambit'] },
  { id: 'relic', name: 'RELIC CASE', tag: 'RL / 09', price: 2800, color: '#9da99c', accent: '#e8c56f', knifeChance: 0.05, weapons: ['heavySniper', 'sniper', 'rifle', 'lmg', 'revolver'], knives: KNIFE_KINDS },
];
export const KEY_PRICE = 250;
export const RARE_REVEAL_TIER = 4;
export const CHARM_CASES: { id: string; name: string; price: number; color: string; charms: CharmId[] }[] = [
  { id: 'field-charms', name: 'FIELD CHARMS CASE', price: 450, color: '#b7bf87', charms: ['field-tag', 'lucky-die', 'cartridge'] },
  { id: 'signal-charms', name: 'SIGNAL CHARMS CASE', price: 700, color: '#61c9c3', charms: ['signal-gem', 'mini-blade'] },
  ...(['OPERATOR', 'ARCADE', 'PRISM', 'RELIC'] as const).map((name, index) => ({ id: `${name.toLowerCase()}-charms`, name: `${name} CHARMS CASE`, price: 450 + index * 150, color: ['#93b390', '#d6a16d', '#67b4c3', '#ba8baf'][index], charms: CHARMS.filter(charm => charm.id.startsWith('collectible-') && Math.floor((charm.seed - 11003) / 1877) >= 0 && Number(charm.id.split('-')[1]) % 4 === index).map(charm => charm.id) })),
];
export function openCharmCase(profile: Profile, caseId: string, random = Math.random) {
  const crate = CHARM_CASES.find(crate => crate.id === caseId); if (!crate || profile.credits < crate.price) return null;
  const charm = rollCharmCase(caseId, profile.unlockedCharms, random); if (!charm) return null;
  profile.credits -= crate.price; (profile.unlockedCharms ||= []).push(charm); return charm;
}
export function rollCharmCase(caseId: string, unlocked: readonly CharmId[] = [], random = Math.random) {
  const available = CHARM_CASES.find(crate => crate.id === caseId)?.charms.filter(charm => !unlocked.includes(charm)) || [];
  return available.length ? available[Math.min(available.length - 1, Math.max(0, Math.floor(random() * available.length)))] : null;
}
export function charmCaseOdds(caseId: string, unlocked: readonly CharmId[] = []) {
  const available = CHARM_CASES.find(crate => crate.id === caseId)?.charms.filter(charm => !unlocked.includes(charm)) || [];
  return RARITIES.map((_, tier) => available.length ? available.filter(id => CHARM_BY_ID.get(id)!.rarity === tier).length / available.length : 0);
}
export function rareReveal(rarity: number) { return rarity >= RARE_REVEAL_TIER; }
export const PROFILE_KEY = 'bs-profile-v2';

export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function wearName(value: number) {
  return value < 0.07 ? 'Factory New' : value < 0.15 ? 'Minimal Wear' : value < 0.38 ? 'Field-Tested' : value < 0.45 ? 'Well-Worn' : 'Battle-Scarred';
}

export function itemValue(item: SkinAppearance) {
  if (item.skinId === DEFAULT_KNIFE_ID) return 0;
  const skin = SKIN_BY_ID.get(item.skinId);
  if (!skin) return 0;
  return Math.round(RARITIES[skin.rarity].value * (1.75 - Math.max(0, Math.min(1, item.float)) * 1.2) * (item.statTrak ? 1.65 : 1));
}

export function makeItem(skinId: string, random = Math.random, now = Date.now()): InventoryItem {
  return { uid: `${now.toString(36)}-${Math.floor(random() * 0xffffffff).toString(36)}`, skinId, seed: Math.floor(random() * 1000000), float: Number(random().toFixed(6)), statTrak: random() < 0.1, kills: 0, acquiredAt: now };
}

export function createProfile(): Profile {
  const items = firearmIds.map((id, index) => ({ ...makeItem(`${id}-0`, seededRandom(index + 83)), float: 0.06, statTrak: false }));
  items.push({ ...makeItem(DEFAULT_KNIFE_ID, seededRandom(52)), float: 0.02, statTrak: false });
  return {
    version: 2, credits: 8000, items, equipped: Object.fromEntries(items.map(item => [SKIN_BY_ID.get(item.skinId)!.weapon, item.uid])),
    cases: Object.fromEntries(CASES.map(crate => [crate.id, crate.id === 'dust' ? 1 : 0])), keys: 1, unlockedCharms: [],
    stats: { kills: 0, deaths: 0, headshots: 0, shots: 0, hits: 0, wins: 0, rounds: 0, planted: 0, defused: 0, weapons: {} },
  };
}

export function equippedAppearance(profile: Profile, weapon: WeaponId) {
  return profile.items.find(item => item.uid === profile.equipped[weapon]);
}

export function caseOdds(caseId: string) {
  const crate = CASES.find(value => value.id === caseId);
  if (!crate) throw new Error('Unknown case');
  const regularWeight = RARITIES.slice(0, 6).reduce((sum, rarity) => sum + rarity.weight, 0);
  return RARITIES.map((rarity, index) => index === 6 ? crate.knifeChance : rarity.weight / regularWeight * (1 - crate.knifeChance));
}

export function rollCase(caseId: string, random = Math.random) {
  const crate = CASES.find(crate => crate.id === caseId)!;
  const odds = caseOdds(caseId);
  let roll = random();
  let rarity = 6;
  for (let index = 0; index < odds.length; index++) {
    roll -= odds[index];
    if (roll < 0) { rarity = index; break; }
  }
  const pool = SKIN_CATALOG.filter(skin => skin.id !== DEFAULT_KNIFE_ID && skin.rarity === rarity && (skin.knife ? crate.knives.includes(skin.knife) : !crate.weapons.length || crate.weapons.includes(skin.weapon)));
  return makeItem(pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))].id, random);
}

export function caseOpeningCost(profile: Profile, caseId: string) {
  const crate = CASES.find(crate => crate.id === caseId);
  return crate ? ((profile.cases[caseId] || 0) > 0 ? 0 : crate.price) + (profile.keys > 0 ? 0 : KEY_PRICE) : null;
}

export function openCase(profile: Profile, caseId: string, random = Math.random, purchaseMissing = false) {
  const cost = caseOpeningCost(profile, caseId);
  if (cost === null || !purchaseMissing && cost > 0 || purchaseMissing && profile.credits < cost) return null;
  const item = rollCase(caseId, random);
  profile.credits -= cost; profile.cases[caseId] = Math.max(0, (profile.cases[caseId] || 0) - 1); profile.keys = Math.max(0, profile.keys - 1); profile.items.push(item);
  return item;
}

export function validAppearance(value: unknown, weapon?: WeaponId): value is SkinAppearance {
  if (!value || typeof value !== 'object') return false;
  const item = value as SkinAppearance;
  const definition = SKIN_BY_ID.get(item.skinId);
  return !!definition && (!weapon || definition.weapon === weapon) && Number.isSafeInteger(item.seed) && item.seed >= 0 && item.seed <= 1000000 &&
    Number.isFinite(item.float) && item.float >= 0 && item.float <= 1 && typeof item.statTrak === 'boolean' && Number.isSafeInteger(item.kills) && item.kills >= 0 && (item.charm === undefined || CHARM_BY_ID.has(item.charm));
}

export function attachCharm(profile: Profile, uid: string, charm: unknown) {
  const item = profile.items.find(item => item.uid === uid); if (!item || charm !== '' && (!CHARMS.some(option => option.id === charm) || !profile.unlockedCharms?.includes(charm as CharmId))) return false;
  if (charm === '') delete item.charm; else item.charm = charm as CharmId;
  return true;
}