import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow-condensed/latin-600.css';
import './style.css';
import './interface.css';
import { GameAudio } from './audio.ts';
import { flashPresentation } from '../shared/equipment.ts';
import { Network } from './network.ts';
import { InputButtons } from './input.ts';
import { GameWorld } from './world.ts';
import { Armory, escapeHtml, refreshIcons } from './armory.ts';
import { SettingsController } from './settings.ts';
import { SocialPanel } from './social.ts';
import { MAPS, SUPPLIED_MAP_IDS, MAP_SIZE, STEP, equipPlayer, getSites, hasRespawns, WEAPONS, THROWABLES, type Mode, type ThrowableId, type Difficulty, type Input, type MapId, type Player, type Snapshot, type WeaponId } from '../shared/game.ts';
import { SKIN_BY_ID, creditReward } from '../shared/economy.ts';
import { mapGeometry } from '../shared/map-geometry.ts';
import { canPurchase, isBombRound, matchLineup } from '../shared/round.ts';
import { GUN_GAME_ORDER } from '../shared/modes.ts';
import { TRAINING_MAP } from '../shared/training.ts';

const $ = <ElementType extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as ElementType;
const icon = (name: string) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="shell"><div class="world" id="world"></div><div class="grain"></div>
    <header class="topbar"><a class="brand" href="#" aria-label="Browserstrike"><span class="brand-mark">B</span><span>BROWSER<span>STRIKE</span></span></a><div class="top-status"><i></i><span id="arena-label">DUSTLINE</span><span class="top-divider"></span><span>SEASON 02 / FIELD OPERATIONS</span></div><div class="top-actions"><button class="icon-button" id="stats-open" title="Statistics" aria-label="Statistics">${icon('trophy')}</button><button class="icon-button" id="settings-open" title="Settings" aria-label="Settings">${icon('settings')}</button><button class="icon-button" id="sound-button" title="Toggle sound" aria-label="Toggle sound">${icon('volume-2')}</button></div></header>
    <section class="lobby" id="lobby"><div class="lobby-copy"><span class="eyebrow"><i></i>FIELD OPERATIONS / 02</span><h1>BROWSER<br><em>STRIKE</em></h1><p id="map-subtitle">SUPPLIED ARENAS</p><div class="lobby-facts"><span><b>${SUPPLIED_MAP_IDS.length.toString().padStart(2, '0')}</b>ARENAS</span><span><b>500+</b>PER WEAPON</span><span><b>20</b>FIREARMS</span></div><button class="locker-shortcut" id="locker-open">${icon('package')} YOUR LOCKER ${icon('arrow-right')}</button></div>
      <div class="join-panel"><div class="panel-heading"><div><span class="eyebrow">DEPLOYMENT</span><h2>Enter the match</h2></div><span class="live-tag"><i></i>READY</span></div>
        <form id="join-form"><div class="deployment-tabs" role="group" aria-label="Deployment type"><button id="online-button" type="button" data-deployment="online" aria-pressed="true">${icon('users')}<span>ONLINE MULTIPLAYER</span></button><button id="training-button" type="button" data-deployment="training" aria-pressed="false">${icon('crosshair')}<span>AIM TRAINER</span></button><button id="practice-button" type="button" data-deployment="solo" aria-pressed="false">${icon('shield')}<span>SOLO</span></button></div><label class="field-label" for="player-name">CALLSIGN</label><input id="player-name" maxlength="18" autocomplete="nickname" placeholder="Operator" required>
          <div id="online-options"><label class="field-label deployment-field">GAME MODE<select id="mode-select" class="map-select"><option value="deathmatch">DEATHMATCH</option><option value="defusal">BOMB DEFUSAL</option></select></label><label class="field-label room-label" for="room-code">ROOM CODE <span>optional</span></label><input id="room-code" maxlength="6" autocomplete="off" placeholder="Create a room or enter code" autocapitalize="characters"><details class="server-details"><summary>SERVER ADDRESS <span id="server-summary">Current host</span></summary><input id="server-address" autocomplete="url" placeholder="wss://your-server.onrender.com/ws"></details></div>
          <div id="local-options" class="hidden"><div class="deployment-selects"><label class="field-label">ARENA<select id="map-select" class="map-select">${SUPPLIED_MAP_IDS.map(id => `<option value="${id}">${MAPS[id].name.toUpperCase()}</option>`).join('')}</select></label><label class="field-label">BOT DIFFICULTY<select id="difficulty-select" class="map-select"><option value="easy">EASY</option><option value="normal" selected>NORMAL</option><option value="hard">HARD</option></select></label></div></div>
          <label id="solo-options" class="field-label deployment-field hidden">GAME MODE<select id="solo-mode" class="map-select"><option value="elimination">5V5 ELIMINATION</option><option value="defusal">BOMB DEFUSAL</option></select></label>
          <label id="training-options" class="field-label deployment-field hidden">STARTING WEAPON<select id="training-weapon" class="map-select">${(Object.keys(WEAPONS) as WeaponId[]).filter(id => id !== 'knife').map(id => `<option value="${id}">${WEAPONS[id].name}</option>`).join('')}</select></label>
          <button class="deploy-button" id="deploy-button" type="submit">${icon('users')}<span id="deploy-label">CREATE ROOM</span>${icon('arrow-right')}</button><p class="form-error" id="form-error" role="alert"></p>
        </form><div class="lobby-tools"><button id="shop-open" type="button">${icon('boxes')}ARMORY</button></div><div class="active-loadout"><span>LOADOUT</span><b id="lobby-loadout"></b></div><div class="panel-foot"><span>LOCAL PROFILE</span><span>ORIGINAL FIELD EQUIPMENT</span></div></div>
      <div class="lobby-bottom"><span>BROWSERSTRIKE / COMMUNITY SERVERS</span><span id="lobby-environment">DAY / CLEAR</span></div>
    </section>
    <section class="settings-overlay hidden" id="settings-overlay" role="dialog" aria-modal="true" aria-label="Settings"></section>
    <section class="game-ui hidden" id="game-ui"><div class="hud-top"><div class="minimap-wrap"><div class="mini-heading"><span id="callout">SPAWN</span><b id="mini-count">01 / 10</b></div><div class="minimap" id="minimap"><div id="mini-walls"></div><div id="mini-dots"></div></div><span class="mini-caption" id="mini-map-name">DUSTLINE</span></div><div class="match-status"><span class="status-phase" id="phase-label">MATCH IN PROGRESS</span><div class="timer" id="timer">05:00</div><div class="team-score"><span class="team-t">T <b id="score-t">0</b></span><span class="score-separator">:</span><span class="team-ct"><b id="score-ct">0</b> CT</span></div></div><div class="match-meta"><span class="connection"><i></i><b id="ping">0</b> MS</span><button class="room-chip" id="room-chip" title="Copy room code"><span>ROOM</span><b id="room-display">------</b>${icon('copy')}</button><span class="meta-hint" id="environment-label">DAY / CLEAR</span></div></div>
      <div class="crosshair" id="crosshair"><i></i><i></i><i></i><i></i><b></b></div><div class="hitmarker" id="hitmarker">&#215;</div><div class="damage-arrow" id="damage-arrow">&#8963;</div><div class="scope-overlay" id="scope-overlay"><i></i><b></b><span></span></div>
      <div class="objective-hud hidden" id="objective-hud"><b id="objective-label"></b><span id="objective-time"></span><progress id="objective-progress" max="1" value="0" aria-label="Bomb interaction progress"></progress></div><div class="round-banner hidden" id="round-banner"><span id="round-title"></span><b id="round-subtitle"></b></div>
      <div class="bottom-hud"><div class="player-vitals"><div class="vital-line"><span>HEALTH</span><b id="health-value">100</b></div><div class="bar"><i id="health-bar"></i></div><div class="vital-line armor-line"><span>ARMOR</span><b id="armor-value">100</b></div><div class="bar armor-bar"><i id="armor-bar"></i></div></div><button class="center-hint" id="center-hint">${icon('crosshair')}RESUME</button><div class="weapon-hud"><div class="weapon-top"><span id="weapon-name">Vandal 762</span><span id="weapon-slot">01</span></div><div class="ammo"><b id="ammo-value">30</b><span> / </span><span id="reserve-value">90</span></div><div class="weapon-key" id="weapon-key">RIFLE</div><div class="reloading hidden" id="reloading">RELOADING</div></div></div>
      <div class="feed" id="feed"></div><div class="chat-box hidden" id="chat-box"><div class="chat-lines" id="chat-lines"></div><form id="chat-form"><span>ROOM</span><input id="chat-input" maxlength="120" autocomplete="off" placeholder="Message your room..."><kbd>ENTER</kbd></form></div>
      <aside class="scoreboard hidden" id="scoreboard"><div class="score-head"><span>OPERATOR</span><span>K</span><span>D</span><span>HP</span></div><div id="score-rows"></div><div class="score-foot"><span id="score-map"></span><span>FIELD OPERATIONS</span></div></aside>
      <aside class="buy-menu hidden" id="buy-menu" aria-label="Weapon shop"><div class="buy-head"><span>FIELD ARSENAL</span><span id="buy-clock"></span><button class="icon-button" id="buy-close" title="Close arsenal" aria-label="Close arsenal">${icon('x')}</button></div><p>MATCH SUPPLY <span id="money-value">$16,000</span></p><div id="buy-items"></div><div class="buy-foot"><span>SPAWN SUPPLY</span><span id="buy-status"></span></div></aside>
      <div class="game-toast" id="game-toast" role="status"></div><button class="leave-button" id="leave-button" title="Leave room">${icon('log-out')}<span>LEAVE</span></button>
    </section></main>`;

const lobby = $('lobby'); const gameUi = $('game-ui');
const nameInput = $<HTMLInputElement>('player-name'); const roomInput = $<HTMLInputElement>('room-code');
const serverInput = $<HTMLInputElement>('server-address'); const mapSelect = $<HTMLSelectElement>('map-select');
const modeSelect = $<HTMLSelectElement>('mode-select'); const errorBox = $('form-error');
nameInput.insertAdjacentHTML('afterend', '<label class="field-label deployment-field">OPERATOR<select id="character-select" class="map-select"><option value="0">FIELD OPERATOR</option><option value="10">EXPRESSIVE ROBOT / ANIMATED</option></select></label>');
const characterSelect = $<HTMLSelectElement>('character-select');
try { characterSelect.value = localStorage.getItem('bs-character') === '10' ? '10' : '0'; } catch {}
characterSelect.onchange = () => persist('bs-character', characterSelect.value);
type SoloMode = 'elimination' | 'defusal' | 'training' | 'hill' | 'gungame';
const modeLabels: Record<Mode, string> = { deathmatch: 'DEATHMATCH', defusal: 'BOMB DEFUSAL', elimination: '5V5 / FIRST TO FIVE', training: 'AIM TRAINING', hill: 'KING OF THE HILL', gungame: 'GUN GAME / FREE FOR ALL', ranked: 'RANKED COMPETITIVE', duel: 'PRIVATE 1V1' };
for (const id of ['mode-select', 'solo-mode']) $(id).insertAdjacentHTML('beforeend', '<option value="hill">KING OF THE HILL</option><option value="gungame">GUN GAME / FREE FOR ALL</option>');
modeSelect.insertAdjacentHTML('beforeend', '<option value="ranked">RANKED COMPETITIVE</option>');
let deployment: 'online' | 'solo' | 'training' = 'online';
let matchmaking = true;
let selectedMap: MapId = 'dune';
try {
  const map = localStorage.getItem('bs-map'); if (map && SUPPLIED_MAP_IDS.includes(map as MapId)) selectedMap = map as MapId;
  nameInput.value = localStorage.getItem('bs-name') || '';
  serverInput.value = localStorage.getItem('bs-server') || import.meta.env.VITE_SERVER_URL || '';
} catch {}
const network = new Network(); const audio = new GameAudio(); const world = new GameWorld($('world'), selectedMap);
const armory = new Armory(world); const settings = new SettingsController(world, $('crosshair'));
const social = new SocialPanel(armory, serverUrl, () => nameInput.value);
const held = new InputButtons(); const feed: { text: string; at: number; kind: string }[] = [];
let yaw = 0; let pitch = 0; let sequence = 0; let initializedAim = false;
let lastFrame = performance.now(); let accumulator = 0; let lastFootstep = 0; let muzzleUntil = 0;
let damageUntil = 0; let hitUntil = 0; let toastUntil = 0; let scoreHeld = false; let chatOpen = false;
let buyOpen = false; let scopeLocked = false; let inspectQueued = false; let previousHp = 100; let shotHeat = 0; let lastBeep = 0;
let menuWeapon: WeaponId | null = null;
let lastBuyWindow = 0;
let discardCaptureMove = false;
let lastInputTime = performance.now();
let resultKey = '';
gameUi.insertAdjacentHTML('beforeend', `<section id="match-results" class="match-results hidden" aria-label="Match results"><header><span id="result-team"></span><h2 id="result-title"></h2><p id="result-score"></p></header><div></div><footer><div id="result-roster" class="result-roster"></div><div class="result-actions"><button class="primary-action" id="result-replay">${icon('rotate-ccw')}PLAY AGAIN</button><button class="back-button" id="result-lobby">${icon('arrow-left')}BACK TO LOBBY</button></div></footer></section>`);
$('mode-select').parentElement!.insertAdjacentHTML('beforebegin', `<div class="matchmaking-tabs" role="group" aria-label="Online access"><button id="match-public" type="button" aria-pressed="true">${icon('globe')}PUBLIC</button><button id="match-private" type="button" aria-pressed="false">${icon('lock')}PRIVATE</button></div>`);
roomInput.previousElementSibling!.id = 'room-code-label';
gameUi.insertAdjacentHTML('beforeend', `<button class="chat-hint" id="chat-hint" title="Open chat (Y)">${icon('message-square')}<kbd>Y</kbd> CHAT</button><div class="pickup-hint hidden" id="pickup-hint"><kbd>E</kbd><span id="pickup-name"></span></div>`);
gameUi.insertAdjacentHTML('beforeend', '<div id="chat-popups" class="chat-popups" role="log" aria-live="polite"></div>');
gameUi.querySelector('.match-status')!.insertAdjacentHTML('beforeend', `<div id="hill-hud" class="hill-hud hidden"><span>${icon('crosshair')}CONTROL / 250s</span><div><b id="hill-time-ct">0.0s</b><span id="hill-owner">NEUTRAL</span><b id="hill-time-t">0.0s</b></div><progress id="hill-progress-ct" max="250" value="0" aria-label="Counter-terrorist hill time"></progress><progress id="hill-progress-t" max="250" value="0" aria-label="Terrorist hill time"></progress></div><div id="gungame-hud" class="gungame-hud hidden"><b id="gun-tier"></b><span id="gun-next"></span></div>`);
$('environment-label').insertAdjacentHTML('afterend', '<span id="supply-timer"></span>');
$('weapon-key').insertAdjacentHTML('afterend', `<div class="grenade-controls"><button data-throw="grenade" title="Throw HE grenade (G)" aria-label="Throw HE grenade">${icon('bomb')}<span id="grenade-count">0</span></button><button data-throw="flashbang" title="Throw flashbang (V)" aria-label="Throw flashbang">${icon('sun')}<span id="flashbang-count">0</span></button></div>`);
gameUi.querySelector('.grenade-controls')!.insertAdjacentHTML('beforeend', `<button data-throw="smoke" title="Throw smoke (C)" aria-label="Throw smoke">${icon('cloud')}<span id="smoke-count">0</span></button><button data-throw="molotov" title="Throw incendiary (Z)" aria-label="Throw incendiary">${icon('flame')}<span id="molotov-count">0</span></button>`);
gameUi.insertAdjacentHTML('beforeend', '<div id="flash-overlay" aria-hidden="true"></div>');
gameUi.insertAdjacentHTML('beforeend', `<aside class="training-panel hidden" id="training-panel"><header><b id="training-level">NORMAL</b><button class="icon-button" id="training-reset" title="Restart training" aria-label="Restart training">${icon('rotate-ccw')}</button></header><dl><div><dt>SCORE</dt><dd id="training-score">0</dd></div><div><dt>ACCURACY</dt><dd id="training-accuracy">0%</dd></div><div><dt>HITS / SHOTS</dt><dd id="training-hits">0 / 0</dd></div><div><dt>BEST STREAK</dt><dd id="training-streak">0</dd></div><div><dt>AVG RESPONSE</dt><dd id="training-response">0ms</dd></div><div><dt>TARGETS</dt><dd id="training-kills">0</dd></div></dl></aside>`);
$('training-options').insertAdjacentHTML('beforebegin', '<label id="training-kind-field" class="field-label deployment-field hidden">TRAINING MODE<select id="training-kind" class="map-select"><option value="aim">TIMED TARGET DRILL</option><option value="range">RECOIL RANGE</option></select></label>');
$('training-panel').insertAdjacentHTML('beforeend', `<label class="field-label">WEAPON<select class="map-select" id="range-weapon">${(Object.keys(WEAPONS) as WeaponId[]).map(id => `<option value="${id}">${WEAPONS[id].name}</option>`).join('')}</select></label>`);
$('training-panel').insertAdjacentHTML('beforeend', `<details id="range-settings" class="range-target-controls hidden"><summary>TARGET SETTINGS</summary><label class="field-label">DISTANCE<select class="map-select" id="range-distance"><option value="10">10 M</option><option value="20">20 M</option><option value="30" selected>30 M</option><option value="40">40 M</option></select></label><label class="field-label">TARGET HEALTH<select class="map-select" id="range-health"><option value="100">100 HP</option><option value="200">200 HP</option><option value="10000" selected>ENDURANCE</option></select></label><label><input type="checkbox" id="range-moving">MOVING TARGET</label><label><input type="checkbox" id="range-armor">ARMORED TARGET</label><button class="text-action" id="range-clear">${icon('rotate-ccw')}RESET TARGET</button><span id="range-last-damage">0 DAMAGE</span></details>`);
const shopPreviews = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) {
    const element = entry.target as HTMLElement; const id = element.dataset.preview as WeaponId;
    element.innerHTML = `<img src="${world.thumbnail(id, armory.appearance(id))}" width="128" height="64" alt="${WEAPONS[id].name}">`; shopPreviews.unobserve(element);
  }
}, { root: $('buy-menu'), rootMargin: '40px' });

function persist(key: string, value: string) { try { localStorage.setItem(key, value); } catch {} }
function showToast(text: string) { $('game-toast').textContent = text; toastUntil = performance.now() + 2400; }
social.onNotice = showToast;
social.onDuelReady = code => {
  leaveRoom(); social.close(); initializedAim = false;
  void network.connect(serverUrl(), { name: social.state?.self.name || nameInput.value || 'Operator', code, mode: 'duel', create: false, account: social.credentials, skin: Number(characterSelect.value), cosmetics: armory.cosmetics() }).then(enterMatch).catch(error => { errorBox.textContent = error instanceof Error ? error.message : 'Unable to join 1v1.'; });
};
void social.connect(undefined, true).catch(() => {});
function syncLoadout() {
  const weapon = network.predicted?.weapon || armory.selectedWeapon;
  const appearance = armory.appearance(weapon);
  world.setWeapon(weapon, 0, performance.now() / 1000, 0, appearance);
  const finish = armory.appearance(armory.selectedWeapon);
  $('lobby-loadout').textContent = `${WEAPONS[armory.selectedWeapon].name} / ${finish ? SKIN_BY_ID.get(finish.skinId)?.name : 'Field Issue'}`;
  if (network.predicted) network.predicted.cosmetics = armory.cosmetics();
  network.send({ type: 'cosmetics', cosmetics: armory.cosmetics() });
}
armory.onEquip = syncLoadout; armory.onSound = reveal => reveal ? audio.round(true) : audio.click();
world.onAssetsChanged = () => { if (armory.isOpen) armory.render(); if (buyOpen) renderBuyMenu(); };
syncLoadout(); refreshIcons();

function updateMapLabels() {
  mapSelect.value = selectedMap; world.setMap(selectedMap);
  $('arena-label').textContent = MAPS[selectedMap].name.toUpperCase(); $('mini-map-name').textContent = MAPS[selectedMap].name.toUpperCase();
  $('map-subtitle').textContent = MAPS[selectedMap].subtitle.toUpperCase();
  const extent = MAP_SIZE;
  $('mini-walls').innerHTML = MAPS[selectedMap].solids.map(solid => `<i class="mini-wall" style="left:${(solid.x - solid.w / 2 + extent) / (extent * 2) * 100}%;top:${(solid.z - solid.d / 2 + extent) / (extent * 2) * 100}%;width:${solid.w / (extent * 2) * 100}%;height:${solid.d / (extent * 2) * 100}%"></i>`).join('');
  const map = selectedMap;
  void world.prepareMap(map).then(() => {
    if (selectedMap !== map) return;
    world.setMap(map);
    const geometry = mapGeometry(map); if (!geometry) return;
    const size = geometry.metadata.cell; const floor = geometry.metadata.navigation.map(point => `M${point.x + extent - size / 2} ${point.z + extent - size / 2}h${size}v${size}h${-size}z`).join('');
    $('mini-walls').innerHTML = `<svg viewBox="0 0 ${extent * 2} ${extent * 2}" width="100%" height="100%" aria-hidden="true"><path d="${floor}" fill="#8fa9a1" opacity="0.55"/></svg>`;
  }).catch(error => { if (selectedMap === map) errorBox.textContent = error instanceof Error ? error.message : 'Level could not load.'; });
}
network.prepareMap = async map => { await world.prepareMap(map); selectedMap = map; updateMapLabels(); };
updateMapLabels();
mapSelect.addEventListener('change', () => { selectedMap = mapSelect.value as MapId; persist('bs-map', selectedMap); updateMapLabels(); });
$('shop-open').onclick = () => { void audio.unlock(); armory.show('cases'); };
$('locker-open').onclick = () => { void audio.unlock(); armory.show('locker'); };
$('stats-open').onclick = () => armory.show('stats');
$('settings-open').onclick = () => settings.show();
$('sound-button').onclick = async () => { await audio.unlock(); const muted = audio.toggle(); $('sound-button').innerHTML = icon(muted ? 'volume-x' : 'volume-2'); refreshIcons(); };
function updateDeployment() {
  $('online-options').classList.toggle('hidden', deployment !== 'online');
  $('local-options').classList.toggle('hidden', deployment === 'online');
  $('solo-options').classList.toggle('hidden', deployment !== 'solo');
  $('training-options').classList.toggle('hidden', deployment !== 'training');
  $('training-kind-field').classList.toggle('hidden', deployment !== 'training');
  mapSelect.parentElement!.classList.toggle('hidden', deployment === 'training');
  $('local-options').classList.toggle('trainer-options', deployment === 'training');
  document.querySelectorAll<HTMLButtonElement>('[data-deployment]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.deployment === deployment)));
  nameInput.required = deployment === 'online';
  roomInput.classList.toggle('hidden', matchmaking); $('room-code-label').classList.toggle('hidden', matchmaking);
  $('match-public').setAttribute('aria-pressed', String(matchmaking)); $('match-private').setAttribute('aria-pressed', String(!matchmaking));
  $('deploy-label').textContent = deployment === 'online' ? matchmaking ? 'FIND MATCH' : roomInput.value.trim() ? 'JOIN PRIVATE ROOM' : 'CREATE PRIVATE ROOM' : deployment === 'solo' ? 'DEPLOY SOLO' : 'START TRAINING';
}
$('match-public').onclick = () => { matchmaking = true; updateDeployment(); };
$('match-private').onclick = () => { matchmaking = false; updateDeployment(); };
updateDeployment();
document.querySelectorAll<HTMLButtonElement>('[data-deployment]').forEach(button => {
  button.onclick = () => { deployment = button.dataset.deployment as typeof deployment; errorBox.textContent = ''; updateDeployment(); };
});
roomInput.addEventListener('input', updateDeployment);
serverInput.addEventListener('input', () => { $('server-summary').textContent = serverInput.value ? 'CUSTOM SERVER' : 'CURRENT HOST'; });

function serverUrl() {
  const address = serverInput.value.trim();
  if (!address) return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
  const url = new URL(address.includes('://') ? address : `https://${address}`);
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('Use an HTTP(S) or WS(S) server address.');
  if (url.pathname === '/' || !url.pathname) url.pathname = '/ws';
  return url.toString();
}
function enterMatch() {
  lobby.classList.add('hidden'); gameUi.classList.remove('hidden'); armory.close(); settings.hide();
  $('room-display').textContent = network.code; previousHp = 100; held.clear(); syncLoadout();
  $('training-panel').classList.toggle('hidden', network.state?.mode !== 'training');
  if (network.state?.mode !== 'training' && network.state?.mode !== 'gungame') toggleBuy(true);
}
$('join-form').addEventListener('submit', async event => {
  event.preventDefault(); errorBox.textContent = '';
  if (deployment !== 'online') { await startSolo(deployment === 'training' ? 'training' : $<HTMLSelectElement>('solo-mode').value as SoloMode); return; }
  const name = nameInput.value.trim().slice(0, 18);
  const code = matchmaking ? '' : roomInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (!name) { errorBox.textContent = 'Enter a callsign.'; return; }
  if (code && code.length !== 6) { errorBox.textContent = 'Room codes have 6 characters.'; return; }
  persist('bs-name', name); persist('bs-server', serverInput.value.trim());
  const button = $<HTMLButtonElement>('deploy-button'); button.disabled = true; $('deploy-label').textContent = 'CONNECTING'; initializedAim = false;
  try {
    await audio.unlock();
    try { await social.connect(name); } catch {}
    await network.connect(serverUrl(), { name, code, mode: modeSelect.value, create: !code, matchmaking, account: social.state ? social.credentials : undefined, skin: Number(characterSelect.value), map: selectedMap, cosmetics: armory.cosmetics(), weapon: armory.selectedWeapon });
    enterMatch();
  } catch (error) { errorBox.textContent = error instanceof Error ? error.message : 'Unable to join.'; }
  finally { button.disabled = false; updateDeployment(); }
});
async function startSolo(mode: SoloMode) {
  const name = nameInput.value.trim().slice(0, 18) || 'Operator'; nameInput.value = name; persist('bs-name', name);
  const button = $<HTMLButtonElement>('deploy-button'); button.disabled = true; mapSelect.disabled = true; errorBox.textContent = ''; $('deploy-label').textContent = 'PREPARING ARENA';
  try {
    const map = mode === 'training' ? TRAINING_MAP : SUPPLIED_MAP_IDS.includes(mapSelect.value as MapId) ? mapSelect.value as MapId : 'dune';
    await audio.unlock(); await world.prepareMap(map); world.setMap(map); initializedAim = false;
    network.startPractice({ name, mode, trainingKind: $<HTMLSelectElement>('training-kind').value as 'aim' | 'range', difficulty: $<HTMLSelectElement>('difficulty-select').value as Difficulty, map, skin: Number(characterSelect.value), knifeStyle: 0, owned: ['pistol', 'knife'], weapon: mode === 'training' ? $<HTMLSelectElement>('training-weapon').value as WeaponId : 'pistol', cosmetics: armory.cosmetics() });
    enterMatch();
  } catch (error) { errorBox.textContent = error instanceof Error ? error.message : 'Level could not load.'; }
  finally { button.disabled = false; mapSelect.disabled = false; updateDeployment(); }
}
$('training-reset').onclick = () => void startSolo('training');
$('range-weapon').onchange = () => { equipWeapon($<HTMLSelectElement>('range-weapon').value as WeaponId); void lockPointer(); };
for (const id of ['range-distance', 'range-health', 'range-moving', 'range-armor']) $(id).onchange = () => network.send({ type: 'range', distance: Number($<HTMLSelectElement>('range-distance').value), health: Number($<HTMLSelectElement>('range-health').value), moving: $<HTMLInputElement>('range-moving').checked, armor: $<HTMLInputElement>('range-armor').checked });
$('range-clear').onclick = () => { network.send({ type: 'range' }); world.clearImpacts(); };

function pushFeed(text: string, kind = '') {
  feed.unshift({ text, kind, at: performance.now() }); feed.splice(5);
  $('feed').innerHTML = feed.map(item => `<div class="feed-line ${item.kind}">${item.text}</div>`).join('');
}
function processEvents(snapshot: Snapshot) {
  const self = snapshot.players.find(player => player.id === network.id);
  armory.record(snapshot, network.id);
  for (const event of snapshot.events) {
    if (event.type === 'throw' && event.id === network.id) audio.melee();
    if (event.type === 'explosion' && event.point && event.equipment !== 'smoke' && event.equipment !== 'molotov') { world.explode(event.point); audio.explosion(); }
    if (event.type === 'flash' && event.point) { world.flashbang(event.point); if (self && Math.hypot(self.x - event.point.x, self.z - event.point.z) < 30) audio.flashbang(self.flashedUntil > Date.now() + network.offset ? self.flashStrength : 0); }
    if (event.type === 'melee' && event.id) {
      const local = event.id === network.id;
      world.melee(event.id, local); audio.melee(!local);
    }
    if (event.type === 'shot' && event.origin && event.point && event.weapon) {
      const local = event.id === network.id;
      for (const [index, point] of (event.points || [event.point]).entries()) world.shot(event.origin, point, local, event.weapon, index === 0);
      audio.shot(event.weapon, !local);
      if (local) {
        world.kick(); muzzleUntil = performance.now() / 1000 + 0.065; shotHeat = Math.min(2, shotHeat + 0.7);
        pitch = Math.min(1.45, pitch + WEAPONS[event.weapon].recoil * (scopeLocked ? 0.35 : 0.65));
      }
    }
    if (event.type === 'hit') {
      if (event.id === network.id) { hitUntil = performance.now() + (event.head ? 230 : 140); audio.hit(!!event.head); }
      if (event.target === network.id && self && event.origin) {
        damageUntil = performance.now() + 420; audio.damage();
        const incoming = Math.atan2(event.origin.x - self.x, event.origin.z - self.z);
        $('damage-arrow').style.transform = `translate(-50%,-50%) rotate(${incoming - yaw + Math.PI}rad)`;
      }
    }
    if (event.type === 'kill') {
      const shooter = snapshot.players.find(player => player.id === event.id)?.name || 'EXPLOSION';
      const victim = snapshot.players.find(player => player.id === event.target)?.name || 'OPERATOR';
      pushFeed(`${escapeHtml(shooter)} <i>${event.equipment ? THROWABLES[event.equipment].name : event.weapon ? WEAPONS[event.weapon].short : 'C4'}</i> ${event.head ? '<span class="headshot-label">HS</span>' : ''} ${escapeHtml(victim)}`, event.id === network.id ? 'feed-local' : '');
      if (event.id === network.id) { const reward = creditReward(snapshot.mode, snapshot.code === 'PRACTICE', event, self?.team); showToast(`${event.head ? 'HEADSHOT' : 'ELIMINATION'}${reward ? ` / +${reward} CR` : ''}`); }
    }
    if (event.type === 'reload' && event.id === network.id) audio.reload();
    if (event.type === 'round') {
      $('round-title').textContent = event.team === 'CT' ? 'COUNTER-TERRORISTS WIN' : 'TERRORISTS WIN';
      $('round-subtitle').textContent = `${snapshot.score.T} : ${snapshot.score.CT}${event.text ? ` / MVP ${event.text}` : ''}`;
      $('round-banner').classList.remove('hidden'); audio.round(event.team === self?.team);
      window.setTimeout(() => $('round-banner').classList.add('hidden'), 5000);
    }
    if (event.type === 'bomb') {
      if (event.text) pushFeed(escapeHtml(event.text), 'feed-system');
      if (event.text === 'Bomb exploded' && event.point) { world.explode(event.point); audio.explosion(); }
    }
    if (event.type === 'chat' && event.text) {
      const line = document.createElement('div'); line.className = 'chat-line';
      const name = snapshot.players.find(player => player.id === event.id)?.name || 'SYSTEM';
      line.innerHTML = `<b>${escapeHtml(name)}</b> ${escapeHtml(event.text)}`; $('chat-lines').append(line); $('chat-lines').scrollTop = $('chat-lines').scrollHeight;
      while ($('chat-lines').children.length > 30) $('chat-lines').firstElementChild?.remove();
      if (event.id !== 'server') {
        const popup = document.createElement('div'); popup.className = 'chat-popup'; const author = document.createElement('b'); author.textContent = name;
        popup.append(author, document.createTextNode(event.text)); $('chat-popups').append(popup);
        while ($('chat-popups').children.length > 4) $('chat-popups').firstElementChild?.remove();
        window.setTimeout(() => { popup.classList.add('chat-fading'); window.setTimeout(() => popup.remove(), 300); }, 7500);
      }
    }
  }
}

function slotFor(id: WeaponId) {
  const model = WEAPONS[id].model;
  return model === 'knife' ? 4 : model === 'pistol' ? 2 : model === 'sniper' ? 3 : 1;
}
function updateHud(snapshot: Snapshot, player: Player) {
  gameUi.classList.toggle('training-active', !!snapshot.training);
  const ended = !!snapshot.matchWinner || !!snapshot.matchComplete;
  gameUi.classList.toggle('results-active', ended); $('match-results').classList.toggle('hidden', !ended);
  if (ended && resultKey !== `${snapshot.code}:${snapshot.round}`) {
    resultKey = `${snapshot.code}:${snapshot.round}`; held.clear(); scopeLocked = false; buyOpen = false; chatOpen = false;
    if (document.pointerLockElement) document.exitPointerLock();
    const lineup = matchLineup(snapshot.players, snapshot.mode === 'gungame' || snapshot.matchDraw ? undefined : snapshot.matchWinner, snapshot.winnerId);
    $('result-title').textContent = snapshot.matchDraw ? 'DRAW' : snapshot.winnerId ? snapshot.winnerId === player.id ? 'VICTORY' : 'DEFEAT' : snapshot.matchWinner === player.team ? 'VICTORY' : 'DEFEAT';
    $('result-team').textContent = snapshot.mode === 'gungame' ? 'GUN GAME CHAMPION' : snapshot.matchDraw ? 'FOUR ROUNDS COMPLETE' : snapshot.matchWinner === 'CT' ? 'COUNTER-TERRORISTS' : 'TERRORISTS';
    $('result-score').textContent = `${snapshot.mode === 'gungame' ? '' : `${snapshot.score.CT} : ${snapshot.score.T} / `}MVP ${lineup[0]?.player.name || ''}`;
    $('result-roster').innerHTML = [3, 1, 0, 2, 4].map(index => lineup[index] ? `<div class="${index === 0 ? 'result-mvp' : ''}"><b>${escapeHtml(lineup[index].player.name)}</b><span>${lineup[index].player.kills} K / ${lineup[index].player.deaths} D${index === 0 ? ' / MVP' : ''}</span></div>` : '').join('');
  }
  const mode = snapshot.mode === 'defusal' ? `ROUND ${snapshot.round || 1} / 4 / ${isBombRound(snapshot) ? 'BOMB' : 'ELIMINATION'}` : modeLabels[snapshot.mode];
  $('phase-label').textContent = snapshot.training?.complete ? 'TRAINING COMPLETE' : ended ? snapshot.matchDraw ? 'MATCH DRAWN' : 'MATCH COMPLETE' : snapshot.phase === 'waiting' ? 'WAITING FOR PLAYERS' : snapshot.phase === 'buy' ? 'BUY PHASE' : snapshot.phase === 'over' ? 'ROUND COMPLETE' : snapshot.bomb.planted ? 'BOMB PLANTED' : mode;
  gameUi.querySelector('.team-score')!.classList.toggle('hidden', snapshot.mode === 'gungame');
  $('hill-hud').classList.toggle('hidden', !snapshot.hill); $('gungame-hud').classList.toggle('hidden', !snapshot.gunGame);
  if (snapshot.hill) {
    $('hill-time-ct').textContent = `${(snapshot.hill.held.CT / 1000).toFixed(1)}s`; $('hill-time-t').textContent = `${(snapshot.hill.held.T / 1000).toFixed(1)}s`;
    $('hill-owner').textContent = snapshot.hill.contested ? 'CONTESTED' : snapshot.hill.owner || 'NEUTRAL';
    $<HTMLProgressElement>('hill-progress-ct').value = snapshot.hill.held.CT / 1000; $<HTMLProgressElement>('hill-progress-t').value = snapshot.hill.held.T / 1000;
  }
  if (snapshot.gunGame) { const tier = snapshot.gunGame.levels[player.id] || 0; $('gun-tier').textContent = `TIER ${tier + 1} / ${GUN_GAME_ORDER.length}`; $('gun-next').textContent = tier === GUN_GAME_ORDER.length - 1 ? 'FINAL WEAPON / NEXT KILL WINS' : `NEXT / ${WEAPONS[GUN_GAME_ORDER[tier + 1]].name}`; }
  $('score-t').textContent = String(snapshot.score.T); $('score-ct').textContent = String(snapshot.score.CT);
  const deadline = snapshot.training?.kind === 'range' ? 0 : snapshot.bomb.planted ? snapshot.bomb.endsAt : snapshot.endsAt;
  const seconds = Math.max(0, Math.ceil((deadline - Date.now() - network.offset) / 1000));
  $('timer').textContent = deadline ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : '--:--';
  $('ping').textContent = String(network.ping); $('health-value').textContent = String(player.hp); $('health-bar').style.width = `${player.hp}%`;
  $('room-display').textContent = snapshot.visibility === 'public' ? 'PUBLIC' : network.code;
  $<HTMLButtonElement>('room-chip').disabled = snapshot.visibility === 'public';
  $('room-chip').title = snapshot.visibility === 'public' ? 'Public match' : 'Copy private room code';
  const pickup = snapshot.drops?.find(drop => drop.availableAt <= Date.now() + network.offset && Math.hypot(drop.x - player.x, drop.z - player.z) < 1.8 && Math.abs(drop.y - player.y) < 1.5);
  $('pickup-hint').classList.toggle('hidden', !pickup || player.hp <= 0);
  $('pickup-name').textContent = pickup ? WEAPONS[pickup.weapon].name : '';
  $('armor-value').textContent = String(Math.ceil(player.armor)); $('armor-bar').style.width = `${player.armor}%`;
  $('health-bar').classList.toggle('critical', player.hp <= 30); gameUi.classList.toggle('low-health', player.hp > 0 && player.hp <= 35);
  $('weapon-name').textContent = WEAPONS[player.weapon].name; $('weapon-slot').textContent = `0${slotFor(player.weapon)}`;
  $('weapon-key').textContent = `${WEAPONS[player.weapon].category}${player.kit ? ' / DEFUSE KIT' : ''}`;
  $('ammo-value').textContent = player.weapon === 'knife' ? '-' : String(player.ammo[player.weapon]); $('reserve-value').textContent = player.weapon === 'knife' ? '-' : String(player.reserve[player.weapon]);
  $('reloading').classList.toggle('hidden', !player.reloading); $('money-value').textContent = `$${player.money.toLocaleString()}`;
  const supplySeconds = Math.max(0, Math.ceil(((snapshot.buyEndsAt || 0) - Date.now() - network.offset) / 1000));
  $('buy-clock').textContent = `${supplySeconds}s`;
  $('supply-timer').textContent = supplySeconds ? `SPAWN SUPPLY / ${supplySeconds}s` : 'SUPPLY CLOSED';
  for (const kind of Object.keys(THROWABLES) as ThrowableId[]) {
    $(`${kind}-count`).textContent = String(player.grenades[kind]);
    gameUi.querySelector<HTMLButtonElement>(`[data-throw="${kind}"]`)!.disabled = player.hp <= 0 || snapshot.phase !== 'live' || !player.grenades[kind] || !!player.reloading;
  }
  $('training-panel').classList.toggle('hidden', !snapshot.training);
  if (snapshot.training) {
    const training = snapshot.training;
    $('training-level').textContent = training.kind === 'range' ? 'RECOIL RANGE' : `${training.difficulty.toUpperCase()} / ${training.complete ? 'COMPLETE' : '60S SESSION'}`;
    $<HTMLSelectElement>('range-weapon').value = player.weapon;
      $('range-settings').classList.toggle('hidden', training.kind !== 'range');
      if (training.range) $('range-last-damage').textContent = `${training.range.lastDamage} DAMAGE`;
    $('training-score').textContent = String(training.score); $('training-kills').textContent = String(training.kills);
    $('training-accuracy').textContent = `${Math.round(training.hits / Math.max(1, training.shots) * 100)}%`;
    $('training-hits').textContent = `${training.hits} / ${training.shots}`; $('training-streak').textContent = String(training.bestStreak);
    $('training-response').textContent = `${Math.round(training.reactionTotal / Math.max(1, training.responses))}ms`;
  }
  if (buyOpen && !canPurchase(snapshot, player, Date.now() + network.offset)) toggleBuy(false);
  $('center-hint').classList.toggle('hidden', document.pointerLockElement === world.renderer.domElement || buyOpen || chatOpen || armory.isOpen || settings.isOpen);
  $('score-map').textContent = `${MAPS[selectedMap].name.toUpperCase()} / ${snapshot.mode.toUpperCase()}`;
  const sorted = [...snapshot.players].sort((first, second) => (snapshot.gunGame?.levels[second.id] || 0) - (snapshot.gunGame?.levels[first.id] || 0) || second.kills - first.kills || first.deaths - second.deaths);
  $('score-rows').innerHTML = sorted.map(operator => `<div class="score-row ${operator.id === network.id ? 'score-self' : ''}"><span><i class="team-dot ${operator.team.toLowerCase()}"></i>${escapeHtml(operator.name)}${operator.id === network.id ? '<small>YOU</small>' : ''}</span><b>${operator.kills}</b><span>${operator.deaths}</span><i class="score-hp">${operator.hp || 'OUT'}</i></div>`).join('');
  $('mini-count').textContent = `${String(snapshot.players.length).padStart(2, '0')} / 10`;
  $('mini-dots').innerHTML = snapshot.players.filter(operator => (snapshot.mode === 'gungame' ? operator.id === player.id : operator.team === player.team) && operator.hp > 0).map(operator => `<i class="mini-dot ${operator.team.toLowerCase()} ${operator.id === network.id ? 'you' : ''}" style="left:${(operator.x + MAP_SIZE) / (MAP_SIZE * 2) * 100}%;top:${(operator.z + MAP_SIZE) / (MAP_SIZE * 2) * 100}%"></i>`).join('') + (isBombRound(snapshot) ? getSites(selectedMap).map(site => `<span class="mini-site" style="left:${(site.x + MAP_SIZE) / (MAP_SIZE * 2) * 100}%;top:${(site.z + MAP_SIZE) / (MAP_SIZE * 2) * 100}%">${site.name}</span>`).join('') : '');
  const nearbySite = isBombRound(snapshot) && getSites(selectedMap).find(site => Math.hypot(player.x - site.x, player.z - site.z) < 15);
  $('callout').textContent = nearbySite ? `${nearbySite.name} SITE` : Math.abs(player.x) < 38 && Math.abs(player.z) < 38 ? 'CENTRAL' : `${player.z < -38 ? 'NORTH' : player.z > 38 ? 'SOUTH' : ''} ${player.x < -38 ? 'WEST' : player.x > 38 ? 'EAST' : 'DISTRICT'}`.trim();
  const bomb = snapshot.bomb;
  const carrier = bomb.carrier === player.id;
  $('objective-hud').classList.toggle('hidden', !isBombRound(snapshot) || !carrier && !bomb.planted && !bomb.position);
  $('objective-label').textContent = bomb.actor === player.id ? bomb.planted ? 'DEFUSING' : 'PLANTING' : carrier ? 'C4 / CARRIER' : bomb.planted ? 'C4 / ACTIVE' : 'C4 / DROPPED';
  $('objective-time').textContent = bomb.planted ? `${seconds}s` : '';
  $<HTMLProgressElement>('objective-progress').value = bomb.progress;
  if (player.hp < previousHp) damageUntil = performance.now() + 420;
  if (previousHp > 0 && player.hp <= 0) showToast(hasRespawns(snapshot.mode) ? 'ELIMINATED / REDEPLOYING' : 'ELIMINATED');
  if (previousHp <= 0 && player.hp === 100) { yaw = player.yaw; pitch = player.pitch; held.clear(); }
  previousHp = player.hp;
  if (buyOpen) updateBuyAvailability(snapshot, player);
}

function updateBuyAvailability(snapshot: Snapshot, player: Player) {
  const phaseLocked = !canPurchase(snapshot, player, Date.now() + network.offset);
  $('buy-items').querySelectorAll<HTMLButtonElement>('[data-buy]').forEach(button => {
    const item = button.dataset.buy!;
    const definition = WEAPONS[item as WeaponId];
    const throwable = THROWABLES[item as ThrowableId];
    const price = item === 'armor' ? 650 : item === 'kit' ? 400 : throwable ? throwable.price : definition.price;
    const owned = item === 'armor' ? player.armor >= 100 : item === 'kit' ? player.kit : throwable ? player.grenades[item as ThrowableId] >= throwable.limit : player.owned.includes(item as WeaponId);
    button.classList.toggle('hidden', item === 'kit' && (!isBombRound(snapshot) || player.team !== 'CT'));
    const reason = phaseLocked ? 'Supply closed or outside your spawn area' : item === 'kit' && (player.team !== 'CT' || !isBombRound(snapshot)) ? 'CT bomb defusal only' : throwable && Object.values(player.grenades).reduce((total, count) => total + count, 0) >= 3 ? 'Three utility items maximum' : owned ? 'Already equipped' : price > player.money ? 'Insufficient match supply' : '';
    button.disabled = !!reason; button.title = reason || `Buy ${definition?.name || throwable?.name || (item === 'kit' ? 'Defuse Kit' : 'Kevlar Armor')}`;
    button.classList.toggle('already-owned', owned);
  });
}

function renderBuyMenu() {
  shopPreviews.disconnect();
  $('buy-items').innerHTML = (Object.keys(WEAPONS) as WeaponId[]).map(id => `<button class="buy-item" data-buy="${id}"><span class="shop-preview" data-preview="${id}">${icon('crosshair')}</span><span><b>${WEAPONS[id].name}</b><small>${WEAPONS[id].category} / ${WEAPONS[id].capacity} RND</small></span><strong>$${WEAPONS[id].price.toLocaleString()}</strong></button>`).join('') + `<button class="buy-item equipment-buy" data-buy="armor">${icon('plus')}<span><b>Kevlar Armor</b><small>100 ARMOR</small></span><strong>$650</strong></button><button class="buy-item equipment-buy" data-buy="kit">${icon('key-round')}<span><b>Defuse Kit</b><small>CT EQUIPMENT</small></span><strong>$400</strong></button>`;
  $('buy-items').insertAdjacentHTML('beforeend', (Object.keys(THROWABLES) as ThrowableId[]).map(kind => `<button class="buy-item equipment-buy" data-buy="${kind}">${icon(kind === 'grenade' ? 'bomb' : kind === 'flashbang' ? 'sun' : kind === 'smoke' ? 'cloud' : 'flame')}<span><b>${THROWABLES[kind].name}</b><small>LIMIT ${THROWABLES[kind].limit} / 3 UTILITY TOTAL</small></span><strong>$${THROWABLES[kind].price}</strong></button>`).join(''));
  if (network.state && network.predicted) updateBuyAvailability(network.state, network.predicted);
  $('buy-items').querySelectorAll<HTMLElement>('[data-preview]').forEach(element => shopPreviews.observe(element));
  refreshIcons();
}
function toggleBuy(open: boolean) {
  if (open && network.state && network.predicted && !canPurchase(network.state, network.predicted, Date.now() + network.offset)) { showToast('SPAWN SUPPLY UNAVAILABLE'); return; }
  buyOpen = open; held.clear(); scopeLocked = false; $('buy-menu').classList.toggle('hidden', !open);
  if (open) { if (document.pointerLockElement) document.exitPointerLock(); renderBuyMenu(); }
  else void lockPointer();
}
$('buy-items').onclick = event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-buy]');
  if (!button) return;
  network.send({ type: 'buy', item: button.dataset.buy }); $('buy-status').textContent = 'PURCHASE REQUESTED'; audio.click();
};
$('buy-close').onclick = () => toggleBuy(false);
gameUi.querySelectorAll<HTMLButtonElement>('[data-throw]').forEach(button => { button.onclick = () => network.send({ type: 'throw', item: button.dataset.throw }); });
function leaveRoom() {
  if (network.state) world.setMatch({ ...network.state, projectiles: [], drops: [], smokes: [], fires: [], matchWinner: undefined, matchComplete: false, hill: undefined, gunGame: undefined });
  network.disconnect(); if (document.pointerLockElement) document.exitPointerLock();
  gameUi.classList.add('hidden'); lobby.classList.remove('hidden'); feed.splice(0); $('feed').innerHTML = ''; $('chat-lines').innerHTML = ''; errorBox.textContent = '';
  $('chat-popups').replaceChildren();
  held.clear(); chatOpen = false; buyOpen = false; scoreHeld = false; scopeLocked = false; initializedAim = false; lastBuyWindow = 0;
  resultKey = ''; $('match-results').classList.add('hidden'); gameUi.classList.remove('results-active');
  $('chat-box').classList.add('hidden'); $('scoreboard').classList.add('hidden'); $('buy-menu').classList.add('hidden'); $('round-banner').classList.add('hidden');
  world.updatePlayers([], '', 0, 0); syncLoadout();
  if (selectedMap === TRAINING_MAP) { selectedMap = 'dune'; updateMapLabels(); }
}
$('leave-button').onclick = leaveRoom;
$('result-lobby').onclick = leaveRoom;
$('result-replay').onclick = async () => { const mode = network.state?.mode; const offline = network.code === 'PRACTICE'; leaveRoom(); if (offline && mode && ['elimination', 'defusal', 'training', 'hill', 'gungame'].includes(mode)) await startSolo(mode as SoloMode); else $<HTMLFormElement>('join-form').requestSubmit(); };
$('room-chip').onclick = async () => { try { await navigator.clipboard.writeText(network.code); showToast('ROOM CODE COPIED'); } catch { showToast(`ROOM ${network.code}`); } };
network.onClose = () => { if (!gameUi.classList.contains('hidden')) { leaveRoom(); errorBox.textContent = 'Server connection lost.'; } };
network.onError = text => { showToast(text); $('buy-status').textContent = text; };
network.onState = snapshot => {
  world.setMatch(snapshot);
  if (snapshot.map !== selectedMap) { selectedMap = snapshot.map; updateMapLabels(); }
  if (!initializedAim && network.predicted) { yaw = network.predicted.yaw; pitch = network.predicted.pitch; initializedAim = true; }
  if (snapshot.mode !== 'training' && snapshot.buyEndsAt && snapshot.buyEndsAt !== lastBuyWindow) {
    lastBuyWindow = snapshot.buyEndsAt;
    if (!gameUi.classList.contains('hidden') && network.predicted?.hp) toggleBuy(true);
  }
  processEvents(snapshot);
  if (network.predicted) updateHud(snapshot, network.predicted);
};

async function lockPointer() {
  if (!network.state || network.state.matchWinner || network.state.matchComplete || chatOpen || buyOpen || settings.isOpen || armory.isOpen) return;
  await audio.unlock();
  if (document.pointerLockElement !== world.renderer.domElement) try { await world.renderer.domElement.requestPointerLock(); } catch { showToast('CLICK THE ARENA TO RESUME'); }
}
world.renderer.domElement.onclick = () => void lockPointer(); $('center-hint').onclick = () => void lockPointer();
document.addEventListener('pointerlockchange', () => {
  discardCaptureMove = document.pointerLockElement === world.renderer.domElement;
  if (discardCaptureMove) world.renderer.domElement.focus({ preventScroll: true });
  if (!document.pointerLockElement) { held.clear(); scopeLocked = false; }
});
document.addEventListener('mousemove', event => {
  if (document.pointerLockElement !== world.renderer.domElement || chatOpen) return;
  if (discardCaptureMove) {
    if (Math.abs(event.movementX) > window.innerWidth / 2 || Math.abs(event.movementY) > window.innerHeight / 2) return;
    if (event.movementX || event.movementY) discardCaptureMove = false;
    return;
  }
  const sensitivity = settings.sensitivity / Math.sqrt(scopeLocked && network.predicted ? WEAPONS[network.predicted.weapon].scope?.zoom || 1 : 1);
  yaw -= event.movementX * 0.0022 * sensitivity; pitch = Math.max(-1.45, Math.min(1.45, pitch - event.movementY * 0.0022 * sensitivity));
});
document.addEventListener('contextmenu', event => { if (document.pointerLockElement) event.preventDefault(); });
function toggleScope() {
  const player = network.predicted;
  if (document.pointerLockElement === world.renderer.domElement && !chatOpen && !buyOpen && !settings.isOpen && !armory.isOpen && !social.isOpen && player && player.hp > 0 && WEAPONS[player.weapon].scope) scopeLocked = !scopeLocked;
}
document.addEventListener('mousedown', event => {
  if (!document.pointerLockElement || chatOpen || buyOpen || settings.isOpen || armory.isOpen) return;
  if (event.button === 0) held.add('fire');
  if (event.button === 2) toggleScope();
});
document.addEventListener('mouseup', event => { if (event.button === 0) held.delete('fire'); });
function equipWeapon(weapon: WeaponId) {
  if (!network.predicted?.owned.includes(weapon)) return;
  equipPlayer(network.predicted, weapon); scopeLocked = false; syncLoadout();
}
function openChat() { if (!network.state) return; chatOpen = true; held.clear(); scopeLocked = false; if (document.pointerLockElement) document.exitPointerLock(); $('chat-box').classList.remove('hidden'); $('chat-input').focus(); }
$('chat-hint').onclick = openChat;
document.addEventListener('wheel', event => {
  if (!document.pointerLockElement || !network.predicted) return;
  const weapons = network.predicted.owned; const index = weapons.indexOf(network.predicted.weapon);
  equipWeapon(weapons[(index + (event.deltaY > 0 ? 1 : -1) + weapons.length) % weapons.length]);
}, { passive: true });
document.addEventListener('keydown', event => {
  if (event.code === 'Escape') {
    if (document.pointerLockElement) document.exitPointerLock(); held.clear(); scopeLocked = false;
    if (social.isOpen) { social.close(); return; }
    if (armory.isOpen) { armory.close(); return; }
    if (settings.isOpen) { settings.hide(); return; }
    if (buyOpen) { buyOpen = false; $('buy-menu').classList.add('hidden'); }
    if (chatOpen) { chatOpen = false; $('chat-box').classList.add('hidden'); }
    return;
  }
  if ((event.target as HTMLElement).matches('input,select,textarea') || social.isOpen || armory.isOpen || settings.isOpen) return;
  if (event.code === 'KeyF' && !network.state) { world.inspect(performance.now() / 1000); return; }
  if (!network.state) return;
  if (event.code === 'Tab') { event.preventDefault(); scoreHeld = true; $('scoreboard').classList.remove('hidden'); return; }
  if (event.code === 'KeyY') { openChat(); return; }
  if (event.code === 'KeyH' && !event.repeat && document.pointerLockElement) { network.send({ type: 'drop' }); return; }
  if (event.code === 'KeyE' && !event.repeat && document.pointerLockElement && !$('pickup-hint').classList.contains('hidden')) { network.send({ type: 'pickup' }); return; }
  if (event.code === 'KeyB' && !event.repeat) { event.preventDefault(); toggleBuy(!buyOpen); return; }
  if (event.code === 'KeyQ' && !event.repeat) { event.preventDefault(); toggleScope(); return; }
  if ((event.code === 'KeyG' || event.code === 'KeyV') && !event.repeat && document.pointerLockElement && !buyOpen && !chatOpen) { network.send({ type: 'throw', item: event.code === 'KeyG' ? 'grenade' : 'flashbang' }); return; }
  if ((event.code === 'KeyC' || event.code === 'KeyZ') && !event.repeat && document.pointerLockElement && !buyOpen && !chatOpen) { network.send({ type: 'throw', item: event.code === 'KeyC' ? 'smoke' : 'molotov' }); return; }
  if (event.code === 'KeyF' && !event.repeat) { inspectQueued = true; return; }
  if (event.code === 'KeyR' && !event.repeat) { held.add('reload'); return; }
  if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
  if (['1', '2', '3', '4'].includes(event.key) && network.predicted) {
    const candidates = network.predicted.owned.filter(id => slotFor(id) === Number(event.key));
    if (candidates.length) equipWeapon(candidates[(candidates.indexOf(network.predicted.weapon) + 1) % candidates.length]);
  }
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'Space', 'ControlLeft', 'ControlRight'].includes(event.code)) held.add(event.code);
});
document.addEventListener('keyup', event => { if (event.code === 'Tab') { scoreHeld = false; $('scoreboard').classList.add('hidden'); } held.delete(event.code); });
window.addEventListener('blur', () => { held.clear(); scopeLocked = false; scoreHeld = false; $('scoreboard').classList.add('hidden'); });
$('chat-form').onsubmit = event => {
  event.preventDefault(); const input = $<HTMLInputElement>('chat-input'); const text = input.value.trim();
  if (text) network.send({ type: 'chat', text }); input.value = ''; chatOpen = false; $('chat-box').classList.add('hidden'); void lockPointer();
};

function collectInputs() {
  const now = performance.now(); const elapsed = Math.max(0, Math.min(0.1, (now - lastInputTime) / 1000)); lastInputTime = now;
  const state = network.state; const player = network.predicted;
  if (!state || !player) { accumulator = 0; held.clear(); return; }
  const active = document.pointerLockElement === world.renderer.domElement && !state.matchWinner && !state.matchComplete && !chatOpen && !buyOpen && !settings.isOpen && !armory.isOpen && !scoreHeld && player.hp > 0;
  const scoped = active && scopeLocked && !!WEAPONS[player.weapon].scope;
  accumulator = Math.min(0.1, accumulator + elapsed);
  while (accumulator >= STEP) {
    accumulator -= STEP;
    const fire = held.consumeFire();
    const input: Input = { seq: sequence++, time: performance.timeOrigin + now - accumulator * 1000 + network.offset - 100, yaw, pitch,
      forward: active ? Number(held.has('KeyW')) - Number(held.has('KeyS')) : 0, side: active ? Number(held.has('KeyD')) - Number(held.has('KeyA')) : 0,
      jump: active && held.has('Space'), crouch: active && (held.has('ControlLeft') || held.has('ControlRight')),
      sprint: false,
      fire: active && fire, reload: active && held.has('reload'), scope: scoped, interact: active && held.has('KeyE'), weapon: player.weapon };
    network.input(input); held.delete('reload');
  }
}
const inputTimer = window.setInterval(collectInputs, STEP * 1000);

function animationFrame(now: number) {
  requestAnimationFrame(animationFrame); const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
  const state = network.state; const player = network.predicted;
  const renderScene = !social.isOpen && (!armory.isOpen || armory.needsScene);
  if (!player || player.hp <= 0) scopeLocked = false;
  const active = document.pointerLockElement === world.renderer.domElement && !state?.matchWinner && !state?.matchComplete && !chatOpen && !buyOpen && !settings.isOpen && !armory.isOpen && !scoreHeld;
  const moving = active && (held.has('KeyW') || held.has('KeyA') || held.has('KeyS') || held.has('KeyD'));
  const scoped = active && scopeLocked && !!player && !!WEAPONS[player.weapon].scope;
  if (active && player && player.hp > 0) {
    if (moving && player.grounded && now - lastFootstep > 430) { audio.footstep(); lastFootstep = now; }
    if (inspectQueued) { world.inspect(now / 1000); inspectQueued = false; }
  }
  if (state && player) {
    if (!state.matchWinner && renderScene) world.updatePlayers(network.interpolated(), network.id, dt, now / 1000);
    if (menuWeapon !== player.weapon) { world.setWeapon(player.weapon, 0, now / 1000, 0, armory.appearance(player.weapon)); menuWeapon = player.weapon; }
    if (state.bomb.planted) {
      const left = Math.max(0, (state.bomb.endsAt - Date.now() - network.offset) / 1000);
      if (now - lastBeep > Math.max(95, left * 24)) { audio.beep(left < 10); lastBeep = now; }
    }
  }
  const decay = Math.exp(-12 * dt); network.error.x *= decay; network.error.y *= decay; network.error.z *= decay;
  if (renderScene) world.update(dt, now / 1000, player, { yaw, pitch }, { lobby: !state, scope: scoped, moving,
    reloading: player?.reloading ? Math.max(0, (player.reloading - Date.now() - network.offset) / 1000) : 0,
    flash: muzzleUntil, error: network.error, bomb: state && (state.bomb.planted || state.bomb.position && !state.bomb.carrier) ? state.bomb.position : null });
  shotHeat *= Math.exp(-5 * dt); settings.update(!!moving, shotHeat);
  const optic = player ? WEAPONS[player.weapon].scope : undefined;
  $('scope-overlay').dataset.reticle = optic?.reticle || ''; $('scope-overlay').dataset.zoom = optic ? `${optic.zoom}x` : '';
  $('scope-overlay').classList.toggle('active', scoped); $('crosshair').classList.toggle('hidden', scoped || !state || player?.hp === 0);
  gameUi.classList.toggle('damage-flash', now < damageUntil); $('hitmarker').classList.toggle('visible', now < hitUntil);
  $('damage-arrow').classList.toggle('visible', now < damageUntil); $('game-toast').classList.toggle('visible', now < toastUntil);
  const exposure = player && player.hp > 0 ? flashPresentation(player, Date.now() + network.offset, settings.reducedFlashes) : { opacity: 0, recovery: 0, muffle: 0 };
  $('flash-overlay').style.opacity = String(exposure.opacity); $('flash-overlay').dataset.active = String(exposure.muffle > 0);
  world.renderer.domElement.style.filter = exposure.recovery > 0.01 ? `saturate(${1 - exposure.recovery * 0.85}) contrast(${1 - exposure.recovery * 0.2}) blur(${exposure.recovery * 1.2}px)` : '';
  audio.updateFlash(exposure.muffle);
}
requestAnimationFrame(animationFrame);
const roomParameter = new URLSearchParams(location.search).get('room'); if (roomParameter) roomInput.value = roomParameter.slice(0, 6).toUpperCase();
window.addEventListener('beforeunload', () => { window.clearInterval(inputTimer); network.disconnect(); });