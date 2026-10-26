import { createIcons, X, ArrowLeft, ArrowRight, Boxes, Package, KeyRound, Search, Check, Eye, Coins, Plus, Minus, Pause, ShoppingCart, Settings, Volume2, VolumeX, LogOut, Copy, Crosshair, Play, Users, ChevronLeft, ChevronRight, Trophy, RotateCcw, Bomb, Sun, Globe, Lock, MessageSquare, Cloud, Flame, UserRound, UserPlus, UserMinus, ArrowLeftRight, ImagePlus, Send, RefreshCw } from 'lucide';
import { WEAPONS, type WeaponId, type Snapshot } from '../shared/game.ts';
import { CHARMS, CHARM_BY_ID, CHARM_CASES, attachCharm, openCharmCase, charmCaseOdds, rareReveal, CASES, KEY_PRICE, PROFILE_KEY, SKIN_CATALOG, SKIN_BY_ID, RARITIES, caseOpeningCost, creditReward, createProfile, equippedAppearance, validAppearance, itemValue, wearName, makeItem, openCase, rollCase, type CharmId, type Profile, type InventoryItem, type SkinAppearance } from '../shared/economy.ts';
import type { GameWorld } from './world.ts';

export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
export function refreshIcons() { createIcons({ icons: { X, ArrowLeft, ArrowRight, Boxes, Package, KeyRound, Search, Check, Eye, Coins, Plus, Minus, Pause, ShoppingCart, Settings, Volume2, VolumeX, LogOut, Copy, Crosshair, Play, Users, ChevronLeft, ChevronRight, Trophy, RotateCcw, Bomb, Sun, Globe, Lock, MessageSquare, Cloud, Flame, UserRound, UserPlus, UserMinus, ArrowLeftRight, ImagePlus, Send, RefreshCw } }); }
const icon = (name: string) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const credits = (value: number) => `${value.toLocaleString()} CR`;
const integer = (value: unknown, max = 10000000) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
type LootVisual = { name: string; category: string; rarity: number; image?: string; gold?: boolean };

export function loadProfile(storage: Pick<Storage, 'getItem'>): Profile {
  const fallback = createProfile();
  try {
    const text = storage.getItem(PROFILE_KEY);
    if (!text) {
      const oldCredits = Number(storage.getItem('bs-credits'));
      if (storage.getItem('bs-credits') && integer(oldCredits)) fallback.credits = oldCredits;
      return fallback;
    }
    const saved = JSON.parse(text) as Profile;
    if (saved.version !== 2 || !Array.isArray(saved.items) || !saved.equipped || !saved.stats || !integer(saved.credits) || !integer(saved.keys)) return fallback;
    const seen = new Set<string>();
    saved.items = saved.items.filter(item => {
      if (!validAppearance(item) || typeof item.uid !== 'string' || item.uid.length > 100 || seen.has(item.uid) || !Number.isFinite(item.acquiredAt)) return false;
      seen.add(item.uid); return true;
    });
    if (!saved.items.length) return fallback;
    for (const weapon of Object.keys(WEAPONS) as WeaponId[]) {
      if (!saved.items.some(item => item.uid === saved.equipped[weapon] && SKIN_BY_ID.get(item.skinId)?.weapon === weapon)) {
        const starter = fallback.items.find(item => SKIN_BY_ID.get(item.skinId)?.weapon === weapon)!;
        saved.items.push(starter); saved.equipped[weapon] = starter.uid;
      }
    }
    saved.cases = Object.fromEntries(CASES.map(crate => [crate.id, integer(saved.cases?.[crate.id], 10000) ? saved.cases[crate.id] : 0]));
    for (const key of ['kills', 'deaths', 'headshots', 'shots', 'hits', 'wins', 'rounds', 'planted', 'defused'] as const) if (!integer(saved.stats[key])) saved.stats[key] = 0;
    saved.stats.weapons = Object.fromEntries(Object.entries(saved.stats.weapons || {}).filter(([id, count]) => Object.hasOwn(WEAPONS, id) && integer(count)));
      saved.unlockedCharms = [...new Set([...(Array.isArray(saved.unlockedCharms) ? saved.unlockedCharms : []), ...saved.items.flatMap(item => item.charm ? [item.charm] : [])])].filter(id => CHARMS.some(charm => charm.id === id));
    return saved;
  } catch { return fallback; }
}

export class Armory {
  readonly profile: Profile;
  selectedWeapon: WeaponId = 'rifle';
  onEquip: () => void = () => {};
  onSound: (reveal: boolean) => void = () => {};
  onCharmChange: (item: InventoryItem, charm: string) => boolean = () => false;
  private tab = 'locker';
  private page = 0;
  private filter = 'all';
  private query = '';
  private opening = false;
  private inspected: InventoryItem | null = null;
  private root: HTMLElement;
  private inspector: HTMLElement;
  private reel: HTMLElement;
  private reelAnimation: Animation | null = null;
  private casePreview: HTMLElement;
  private charmPicker: HTMLElement;
  private pendingCase: { id: string; charm: boolean } | null = null;
  private selectedCharm: CharmId | null = null;
  private storage: Storage;

  constructor(private world: GameWorld, storage: Storage = localStorage) {
    this.storage = storage; this.profile = loadProfile(storage);
    try { const weapon = storage.getItem('bs-equipped-weapon'); if (weapon && Object.hasOwn(WEAPONS, weapon)) this.selectedWeapon = weapon as WeaponId; } catch {}
    document.querySelector('main')!.insertAdjacentHTML('beforeend', `
      <section class="armory-screen hidden" id="armory-screen" role="dialog" aria-modal="true" aria-label="Armory"><div class="armory-header"><div><span class="eyebrow">BROWSERSTRIKE / SUPPLY DIVISION</span><h2>FIELD ARMORY</h2></div><div class="wallet">${icon('coins')}<span id="wallet"></span></div><button class="icon-button" data-armory-close title="Close armory" aria-label="Close armory">${icon('x')}</button></div>
      <nav class="armory-nav" aria-label="Armory views"><button data-tab="locker">${icon('package')}LOCKER</button><button data-tab="weapons">${icon('crosshair')}LOADOUT</button><button data-tab="cases">${icon('boxes')}CASES</button><button data-tab="catalog">${icon('search')}FINISHES <small>${SKIN_CATALOG.length.toLocaleString()}</small></button><button data-tab="stats">${icon('trophy')}STATISTICS</button></nav>
      <div class="armory-toolbar" id="armory-toolbar"><label class="search-field">${icon('search')}<input id="locker-search" type="search" placeholder="Search finishes" aria-label="Search finishes"></label><select id="locker-filter" aria-label="Filter by weapon"><option value="all">ALL WEAPONS</option>${Object.entries(WEAPONS).map(([id, weapon]) => `<option value="${id}">${weapon.name}</option>`).join('')}</select><span id="locker-value"></span></div>
      <div class="armory-body" id="armory-body"></div><footer class="armory-footer"><span id="armory-notice" role="status">LOCAL INVENTORY</span><div class="page-controls"><button class="icon-button" id="page-back" title="Previous page" aria-label="Previous page">${icon('chevron-left')}</button><span id="page-count"></span><button class="icon-button" id="page-next" title="Next page" aria-label="Next page">${icon('chevron-right')}</button></div><span>CR / NO CASH VALUE</span></footer></section>
      <section class="inspect-screen hidden" id="inspect-screen" role="dialog" aria-modal="true" aria-label="Inspect skin"><button class="back-button" id="inspect-close">${icon('arrow-left')} ARMORY</button><span class="inspect-serial" id="inspect-serial"></span><div class="inspect-details" id="inspect-details"></div></section>
      <section class="reel-overlay hidden" id="reel-overlay" role="dialog" aria-modal="true" aria-label="Case opening"><div class="reel-header"><span class="eyebrow">SUPPLY / UNSEALING</span><h2 id="reel-title"></h2></div><div class="reel-window"><div class="reel-track" id="reel-track"></div><i class="reel-marker"></i></div><div class="reel-result" id="reel-result" role="status"></div></section>`);
    this.root = document.getElementById('armory-screen')!;
    this.inspector = document.getElementById('inspect-screen')!;
    this.inspector.insertAdjacentHTML('beforeend', `<div class="inspect-stage" id="inspect-stage" role="img" aria-label="Interactive weapon preview" tabindex="0"></div><div class="inspect-controls"><button class="icon-button" data-studio-action="rotate" title="Pause auto-rotation" aria-label="Pause auto-rotation" aria-pressed="true">${icon('pause')}</button><button class="icon-button" data-studio-action="animate" title="Play inspect animation" aria-label="Play inspect animation">${icon('play')}</button><button class="icon-button" data-studio-action="out" title="Zoom out" aria-label="Zoom out">${icon('minus')}</button><button class="icon-button" data-studio-action="in" title="Zoom in" aria-label="Zoom in">${icon('plus')}</button><button class="icon-button" data-studio-action="reset" title="Reset preview" aria-label="Reset preview">${icon('rotate-ccw')}</button></div>`);
    this.reel = document.getElementById('reel-overlay')!;
    this.root.querySelector('.armory-nav')!.insertAdjacentHTML('beforeend', `<button data-tab="charms">${icon('key-round')}CHARMS</button>`);
    document.querySelector('main')!.insertAdjacentHTML('beforeend', `<section id="case-preview-screen" class="case-preview-screen hidden" role="dialog" aria-modal="true" aria-label="3D case preview"><header><span class="eyebrow">SEALED SUPPLY</span><h2 id="case-preview-name"></h2><button class="icon-button" id="case-preview-close" title="Close case preview" aria-label="Close case preview">${icon('x')}</button></header><div id="case-preview-stage" role="img" aria-label="Rotatable 3D loot case" tabindex="0"></div><footer><span id="case-preview-cost"></span><button class="primary-action" id="case-open-confirm">${icon('key-round')}OPEN CASE</button></footer></section><section id="charm-picker" class="charm-picker hidden" role="dialog" aria-modal="true" aria-label="Apply charm"><div><header><h2 id="charm-picker-title"></h2><button class="icon-button" id="charm-picker-close" title="Close charm picker" aria-label="Close charm picker">${icon('x')}</button></header><label class="field-label">WEAPON<select id="charm-weapon"></select></label><img id="charm-weapon-preview" width="512" height="256" alt="Charm preview on selected weapon"><button class="primary-action" id="charm-apply">${icon('check')}APPLY CHARM</button></div></section>`);
    this.casePreview = document.getElementById('case-preview-screen')!; this.charmPicker = document.getElementById('charm-picker')!;
    document.getElementById('case-preview-close')!.onclick = () => this.closeCasePreview();
    document.getElementById('case-open-confirm')!.onclick = () => { const crate = this.pendingCase; if (!crate) return; this.closeCasePreview(); if (crate.charm) void this.unsealCharm(crate.id); else void this.unseal(crate.id); };
    document.getElementById('charm-picker-close')!.onclick = () => this.charmPicker.classList.add('hidden');
    document.getElementById('charm-weapon')!.onchange = () => this.updateCharmPreview();
    document.getElementById('charm-apply')!.onclick = () => {
      const item = this.profile.items.find(item => item.uid === (document.getElementById('charm-weapon') as HTMLSelectElement).value); if (!item || !this.selectedCharm) return;
      if (this.onCharmChange(item, this.selectedCharm)) this.notice('CHARM UPDATE REQUESTED');
      else if (attachCharm(this.profile, item.uid, this.selectedCharm)) { this.save(); this.onEquip(); this.notice('CHARM APPLIED'); }
      this.charmPicker.classList.add('hidden'); this.render();
    };
    const caseStage = document.getElementById('case-preview-stage')!; let casePointer: number | null = null; let caseX = 0; let caseY = 0;
    caseStage.onpointerdown = event => { casePointer = event.pointerId; caseX = event.clientX; caseY = event.clientY; caseStage.setPointerCapture(casePointer); };
    caseStage.onpointermove = event => { if (event.pointerId !== casePointer) return; this.world.rotateSupplyCase(event.clientX - caseX, event.clientY - caseY); caseX = event.clientX; caseY = event.clientY; };
    caseStage.onpointerup = caseStage.onpointercancel = () => { casePointer = null; };
    caseStage.onkeydown = event => { if (event.key.startsWith('Arrow')) { event.preventDefault(); this.world.rotateSupplyCase(event.key === 'ArrowLeft' ? -12 : event.key === 'ArrowRight' ? 12 : 0, event.key === 'ArrowUp' ? -12 : event.key === 'ArrowDown' ? 12 : 0); } };
    this.reel.querySelector('.reel-header')!.insertAdjacentHTML('beforeend', `<button class="text-action" id="reel-skip" title="Skip opening animation">${icon('chevron-right')}SKIP</button>`);
    document.getElementById('reel-skip')!.onclick = () => this.reelAnimation?.finish();
    this.root.addEventListener('click', event => this.handleClick(event));
    document.getElementById('locker-search')!.addEventListener('input', event => { this.query = (event.target as HTMLInputElement).value.toLowerCase(); this.page = 0; this.render(); });
    document.getElementById('locker-filter')!.addEventListener('change', event => { this.filter = (event.target as HTMLSelectElement).value; this.page = 0; this.render(); });
    document.getElementById('inspect-close')!.addEventListener('click', () => this.closeInspect());
    const stage = document.getElementById('inspect-stage')!; let pointer: number | null = null; let lastX = 0; let lastY = 0;
    stage.addEventListener('pointerdown', event => { pointer = event.pointerId; lastX = event.clientX; lastY = event.clientY; stage.setPointerCapture(pointer); });
    stage.addEventListener('pointermove', event => { if (pointer !== event.pointerId) return; this.world.rotateStudio(event.clientX - lastX, event.clientY - lastY); lastX = event.clientX; lastY = event.clientY; this.rotationButton(false); });
    stage.addEventListener('pointerup', () => { pointer = null; }); stage.addEventListener('pointercancel', () => { pointer = null; });
    stage.addEventListener('wheel', event => { event.preventDefault(); this.world.zoomStudio(event.deltaY > 0 ? -0.08 : 0.08); }, { passive: false });
    stage.addEventListener('keydown', event => { if (event.key.startsWith('Arrow')) { event.preventDefault(); this.world.rotateStudio(event.key === 'ArrowLeft' ? -15 : event.key === 'ArrowRight' ? 15 : 0, event.key === 'ArrowUp' ? -15 : event.key === 'ArrowDown' ? 15 : 0); this.rotationButton(false); } });
    this.inspector.addEventListener('click', event => {
      const control = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-studio-action]');
      if (control) {
        const action = control.dataset.studioAction;
        if (action === 'rotate') this.rotationButton(this.world.toggleStudioRotation());
        if (action === 'animate') this.world.playStudioInspect();
        if (action === 'in' || action === 'out') this.world.zoomStudio(action === 'in' ? 0.1 : -0.1);
        if (action === 'reset' && this.inspected) { this.world.setStudio(this.inspected); this.rotationButton(true); }
        return;
      }
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-equip-inspected], [data-buy-inspected]');
      if (!button || !this.inspected) return;
      if (button.hasAttribute('data-buy-inspected')) this.buyFinish(this.inspected.skinId, this.inspected.seed);
      else this.equip(this.inspected);
    });
    this.inspector.addEventListener('change', event => {
      const select = event.target as HTMLSelectElement;
      if (select.id !== 'inspect-charm' || !this.inspected) return;
      if (this.onCharmChange(this.inspected, select.value)) { this.notice('CHARM UPDATE REQUESTED'); return; }
      if (attachCharm(this.profile, this.inspected.uid, select.value)) { this.save(); this.onEquip(); this.inspect(this.profile.items.find(item => item.uid === this.inspected!.uid)!); }
    });
    this.save();
  }

  get isOpen() { return !this.root.classList.contains('hidden') || !this.inspector.classList.contains('hidden') || !this.reel.classList.contains('hidden'); }
  get needsScene() { return !this.inspector.classList.contains('hidden') || !this.casePreview.classList.contains('hidden'); }
  appearance(weapon: WeaponId): SkinAppearance | undefined { return equippedAppearance(this.profile, weapon); }
  preview(item: SkinAppearance) { return this.world.thumbnail(SKIN_BY_ID.get(item.skinId)!.weapon, item); }
  cosmetics() { return Object.fromEntries((Object.keys(WEAPONS) as WeaponId[]).map(weapon => [weapon, this.appearance(weapon)])); }
  equipOwned(uid: string) { const item = this.profile.items.find(item => item.uid === uid); if (item) this.equip(item); }
  mergeCloudItems(items: InventoryItem[], account: string, charms: CharmId[] = []) {
    const key = `bs-cloud-items:${account}`; let previous: string[] = [];
    try { previous = JSON.parse(this.storage.getItem(key) || '[]'); } catch {}
    const owned = items.filter(item => validAppearance(item)); const removed = new Set(previous); const incoming = new Set(owned.map(item => item.uid));
    this.profile.unlockedCharms = [...new Set([...(this.profile.unlockedCharms || []), ...charms])];
    this.profile.items = this.profile.items.filter(item => !removed.has(item.uid) && !incoming.has(item.uid)).concat(structuredClone(owned));
    for (const weapon of Object.keys(this.profile.equipped) as WeaponId[]) if (!this.profile.items.some(item => item.uid === this.profile.equipped[weapon])) this.profile.equipped[weapon] = this.profile.items.find(item => SKIN_BY_ID.get(item.skinId)?.weapon === weapon)?.uid;
    try { this.storage.setItem(key, JSON.stringify([...incoming])); } catch {}
    if (this.inspected && removed.has(this.inspected.uid) && !incoming.has(this.inspected.uid)) this.closeInspect();
    else if (this.inspected && incoming.has(this.inspected.uid)) this.inspect(this.profile.items.find(item => item.uid === this.inspected!.uid)!);
    this.save(); if (this.isOpen) this.render(); this.onEquip();
  }
  save() {
    try { this.storage.setItem(PROFILE_KEY, JSON.stringify(this.profile)); this.storage.setItem('bs-equipped-weapon', this.selectedWeapon); }
    catch { this.notice('BROWSER STORAGE UNAVAILABLE'); }
  }
  private notice(text: string) {
    document.getElementById('armory-notice')!.textContent = text;
    const notice = document.getElementById('inspect-notice'); if (notice) notice.textContent = text;
  }
  private rotationButton(active: boolean) {
    const button = this.inspector.querySelector<HTMLButtonElement>('[data-studio-action="rotate"]')!;
    button.innerHTML = icon(active ? 'pause' : 'play'); button.setAttribute('aria-pressed', String(active)); button.title = button.ariaLabel = active ? 'Pause auto-rotation' : 'Resume auto-rotation'; refreshIcons();
  }

  show(tab = 'locker') {
    this.closeInspect();
    this.tab = tab; this.page = 0; this.root.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    this.render();
    this.root.querySelector<HTMLButtonElement>('[data-armory-close]')!.focus();
  }
  close() {
    if (this.opening) this.reelAnimation?.finish();
    this.closeCasePreview(); this.charmPicker.classList.add('hidden');
    this.root.classList.add('hidden'); this.reel.classList.add('hidden'); this.closeInspect(); this.onEquip();
  }
  closeInspect() { this.inspector.classList.add('hidden'); this.root.classList.remove('inspecting'); document.querySelector('main')!.classList.remove('studio-active'); this.inspected = null; this.world.setStudio(null); this.onEquip(); }

  private equip(item: InventoryItem) {
    const definition = SKIN_BY_ID.get(item.skinId)!;
    this.profile.equipped[definition.weapon] = item.uid;
    this.selectedWeapon = definition.weapon; this.save(); this.onEquip();
    this.notice(`${definition.name.toUpperCase()} EQUIPPED`); this.render(); this.onSound(false);
    if (this.inspected) this.inspect(item);
  }
  private buyFinish(id: string, seed: number) {
    const item = { ...makeItem(id), seed, float: 0.06, statTrak: false };
    const price = Math.round(itemValue(item) * 1.4);
    if (this.profile.credits < price) { this.notice('INSUFFICIENT SUPPLY CREDITS'); return; }
    this.profile.credits -= price; this.profile.items.push(item); this.save(); this.equip(item);
    if (this.inspected) this.inspect(item);
  }
  private handleClick(event: MouseEvent) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || this.opening) return;
    if (button.hasAttribute('data-armory-close')) { this.close(); return; }
    if (button.dataset.tab) { this.tab = button.dataset.tab; this.page = 0; this.render(); return; }
    if (button.id === 'page-back') { this.page = Math.max(0, this.page - 1); this.render(); return; }
    if (button.id === 'page-next') { this.page++; this.render(); return; }
    if (button.dataset.inspect) {
      const owned = this.profile.items.find(item => item.uid === button.dataset.inspect);
      this.inspect(owned || { ...makeItem(button.dataset.inspect), seed: SKIN_BY_ID.get(button.dataset.inspect)!.seed, float: 0.06, statTrak: false }); return;
    }
    if (button.dataset.weapon) {
      this.selectedWeapon = button.dataset.weapon as WeaponId; this.save(); this.onEquip(); this.render(); return;
    }
    if (button.dataset.buyCase) {
      const crate = CASES.find(crate => crate.id === button.dataset.buyCase)!;
      if (this.profile.credits < crate.price) { this.notice('INSUFFICIENT SUPPLY CREDITS'); return; }
      this.profile.credits -= crate.price; this.profile.cases[crate.id] = (this.profile.cases[crate.id] || 0) + 1; this.save(); this.render(); this.onSound(false); return;
    }
    if (button.hasAttribute('data-buy-key')) {
      if (this.profile.credits < KEY_PRICE) { this.notice('INSUFFICIENT SUPPLY CREDITS'); return; }
      this.profile.credits -= KEY_PRICE; this.profile.keys++; this.save(); this.render(); this.onSound(false); return;
    }
    if (button.dataset.selectCharm) this.chooseCharm(button.dataset.selectCharm as CharmId);
    if (button.dataset.openCase || button.dataset.previewCase) this.previewCase(button.dataset.openCase || button.dataset.previewCase!, false);
    if (button.dataset.openCharmCase) this.previewCase(button.dataset.openCharmCase, true);
  }

  private previewCase(id: string, charm: boolean) {
    const crate = charm ? CHARM_CASES.find(crate => crate.id === id) : CASES.find(crate => crate.id === id); if (!crate) return;
    this.pendingCase = { id, charm }; this.casePreview.classList.remove('hidden'); document.querySelector('main')!.classList.add('supply-active');
    document.getElementById('case-preview-name')!.textContent = crate.name;
    const cost = charm ? crate.price : caseOpeningCost(this.profile, id)!; document.getElementById('case-preview-cost')!.textContent = `${credits(cost)} / NO CASH VALUE`;
    (document.getElementById('case-open-confirm') as HTMLButtonElement).disabled = cost > this.profile.credits;
    this.world.showSupplyCase(crate.color, charm);
  }
  private closeCasePreview() { this.casePreview.classList.add('hidden'); document.querySelector('main')!.classList.remove('supply-active'); this.world.hideSupplyCase(); this.pendingCase = null; }
  private chooseCharm(id: CharmId) {
    if (!this.profile.unlockedCharms?.includes(id)) return; this.selectedCharm = id;
    const select = document.getElementById('charm-weapon') as HTMLSelectElement;
    select.innerHTML = this.profile.items.map(item => { const skin = SKIN_BY_ID.get(item.skinId)!; return `<option value="${escapeHtml(item.uid)}">${WEAPONS[skin.weapon].name} / ${escapeHtml(skin.name)}</option>`; }).join('');
    select.value = this.profile.equipped[this.selectedWeapon] || this.profile.items[0].uid;
    document.getElementById('charm-picker-title')!.textContent = CHARM_BY_ID.get(id)!.name;
    this.charmPicker.classList.remove('hidden'); this.updateCharmPreview();
  }
  private updateCharmPreview() {
    const item = this.profile.items.find(item => item.uid === (document.getElementById('charm-weapon') as HTMLSelectElement).value);
    if (item && this.selectedCharm) (document.getElementById('charm-weapon-preview') as HTMLImageElement).src = this.preview({ ...item, charm: this.selectedCharm });
  }

  private itemCard(item: InventoryItem, catalog = false) {
    const skin = SKIN_BY_ID.get(item.skinId)!;
    const equipped = this.profile.equipped[skin.weapon] === item.uid;
    return `<button class="inventory-item ${equipped ? 'equipped' : ''}" data-inspect="${catalog ? skin.id : item.uid}" style="--rarity:${RARITIES[skin.rarity].color}"><span class="item-meta"><small>${item.statTrak ? 'STATTRAK' : RARITIES[skin.rarity].name.toUpperCase()}</small>${equipped ? icon('check') : icon('eye')}</span><img src="${this.world.thumbnail(skin.weapon, item)}" alt="${escapeHtml(WEAPONS[skin.weapon].name)} ${escapeHtml(skin.name)}" width="256" height="128"><span class="item-weapon">${skin.knife ? skin.knife.toUpperCase() : WEAPONS[skin.weapon].name}</span><b>${skin.name}</b><span class="item-bottom"><small>${catalog ? skin.pattern.toUpperCase() : wearName(item.float)}</small><strong>${credits(catalog ? Math.round(itemValue(item) * 1.4) : itemValue(item))}</strong></span></button>`;
  }

  private caseCard(crate: typeof CASES[number]) {
    const cost = caseOpeningCost(this.profile, crate.id)!;
    const label = cost ? `UNLOCK / ${credits(cost)}` : 'OPEN';
    const available = this.profile.credits >= cost;
    return `<article class="supply-case" style="--case:${crate.color};--case-accent:${crate.accent}"><button class="supply-art supply-preview" data-preview-case="${crate.id}" title="Inspect 3D ${crate.name.toLowerCase()}"><img src="${this.world.caseThumbnail(crate.color)}" width="256" height="128" alt="${crate.name}"></button><div class="supply-copy"><span>${this.profile.cases[crate.id] || 0} CASES / ${this.profile.keys} KEYS</span><h3>${crate.name}</h3><div class="case-actions"><button data-buy-case="${crate.id}" title="Purchase sealed ${crate.name.toLowerCase()}">${icon('plus')} ${credits(crate.price)}</button><button class="primary-action" data-open-case="${crate.id}" ${!available ? 'disabled' : ''} title="${cost ? 'Includes any missing case and universal key' : 'Consumes one case and one universal key'}">${icon('key-round')} ${label}</button></div><details class="case-odds"><summary>DROP ODDS</summary>${this.odds(crate.id)}</details></div></article>`;
  }

  render() {
    if (this.root.classList.contains('hidden')) return;
    document.getElementById('wallet')!.textContent = credits(this.profile.credits);
    document.getElementById('locker-value')!.textContent = `LOCKER ${credits(this.profile.items.reduce((sum, item) => sum + itemValue(item), 0))}`;
    this.root.querySelectorAll<HTMLElement>('[data-tab]').forEach(button => { button.classList.toggle('active', button.dataset.tab === this.tab); button.setAttribute('aria-current', button.dataset.tab === this.tab ? 'page' : 'false'); });
    document.getElementById('armory-toolbar')!.classList.toggle('hidden', !['locker', 'catalog'].includes(this.tab));
    const body = document.getElementById('armory-body')!;
    let pages = 1;
    if (this.tab === 'locker' || this.tab === 'catalog') {
      const catalog = this.tab === 'catalog';
      const items = catalog ? SKIN_CATALOG.map(skin => ({ uid: skin.id, skinId: skin.id, seed: skin.seed, float: 0.06, statTrak: false, kills: 0, acquiredAt: 0 })) : [...this.profile.items].reverse();
      const filtered = items.filter(item => {
        const skin = SKIN_BY_ID.get(item.skinId)!;
        return (this.filter === 'all' || skin.weapon === this.filter) && `${skin.name} ${WEAPONS[skin.weapon].name} ${skin.knife || ''}`.toLowerCase().includes(this.query);
      });
      pages = Math.max(1, Math.ceil(filtered.length / 18)); this.page = Math.min(this.page, pages - 1);
      body.innerHTML = `<div class="section-heading"><h3>${catalog ? 'FINISH COLLECTION' : 'YOUR LOCKER'}</h3><span>${filtered.length} ITEMS</span></div><div class="inventory-grid">${filtered.slice(this.page * 18, this.page * 18 + 18).map(item => this.itemCard(item, catalog)).join('')}</div>${!filtered.length ? '<p class="empty-state">NO MATCHING ITEMS</p>' : ''}`;
    } else if (this.tab === 'charms') {
      const charms = CHARMS.filter(charm => this.profile.unlockedCharms?.includes(charm.id)); pages = Math.max(1, Math.ceil(charms.length / 18)); this.page = Math.min(this.page, pages - 1);
      body.innerHTML = `<div class="section-heading"><h3>CHARM INVENTORY</h3><span>${charms.length} / ${CHARMS.length}</span></div><div class="inventory-grid charm-inventory">${charms.slice(this.page * 18, this.page * 18 + 18).map(charm => `<button class="inventory-item" data-select-charm="${charm.id}" style="--rarity:${RARITIES[charm.rarity].color}"><img src="${this.world.charmThumbnail(charm.id)}" width="256" height="128" alt="${escapeHtml(charm.name)}"><b>${escapeHtml(charm.name)}</b><span class="item-bottom"><small>${RARITIES[charm.rarity].name}</small>${icon('plus')}</span></button>`).join('')}</div>${charms.length ? '' : '<p class="empty-state">NO CHARMS OWNED</p>'}`;
    } else if (this.tab === 'weapons') {
      body.innerHTML = `<div class="section-heading"><h3>DEPLOYMENT LOADOUT</h3><span>${WEAPONS[this.selectedWeapon].name.toUpperCase()}</span></div><div class="inventory-grid">${(Object.keys(WEAPONS) as WeaponId[]).map(id => `<button class="inventory-item loadout-item ${this.selectedWeapon === id ? 'equipped' : ''}" data-weapon="${id}" style="--rarity:#9cd5c7"><span class="item-meta"><small>${WEAPONS[id].category}</small>${this.selectedWeapon === id ? icon('check') : ''}</span><img src="${this.world.thumbnail(id, this.appearance(id))}" alt="${WEAPONS[id].name}" width="256" height="128"><b>${WEAPONS[id].name}</b><span class="item-bottom"><small>${WEAPONS[id].capacity} ROUNDS</small><strong>${WEAPONS[id].damage} DMG</strong></span></button>`).join('')}</div>`;
    } else if (this.tab === 'cases') {
      body.innerHTML = `<div class="section-heading"><h3>SEALED SUPPLY / ${CASES.length} COLLECTIONS</h3><button class="key-purchase" data-buy-key>${icon('key-round')} ${this.profile.keys} KEYS <span>${icon('plus')} ${credits(KEY_PRICE)}</span></button></div><div class="supply-grid">${CASES.map(crate => this.caseCard(crate)).join('')}</div>`;
      body.insertAdjacentHTML('beforeend', `<div class="section-heading charm-case-heading"><h3>CHARM CASES</h3><span>${this.profile.unlockedCharms?.length || 0} / ${CHARMS.length} UNLOCKED</span></div><div class="charm-case-list">${CHARM_CASES.map(crate => { const remaining = crate.charms.filter(id => !this.profile.unlockedCharms?.includes(id)); const odds = charmCaseOdds(crate.id, this.profile.unlockedCharms); return `<article class="charm-case"><div><img src="${this.world.caseThumbnail(crate.color)}" width="160" height="80" alt="${crate.name}"><h3>${crate.name}</h3><span>${remaining.length} CHARMS REMAINING</span></div><button class="primary-action" data-open-charm-case="${crate.id}" ${!remaining.length || this.profile.credits < crate.price ? 'disabled' : ''}>${icon('package')}${remaining.length ? `OPEN / ${credits(crate.price)}` : 'COLLECTION COMPLETE'}</button><details class="case-odds"><summary>DROP ODDS</summary>${odds.map((chance, tier) => chance ? `<span>${RARITIES[tier].name}<b>${(chance * 100).toFixed(2)}%</b></span>` : '').join('')}</details></article>`; }).join('')}</div>`);
    } else {
      const stats = this.profile.stats;
      const favorite = (Object.entries(stats.weapons) as [WeaponId, number][]).sort((first, second) => second[1] - first[1])[0]?.[0];
      const rows = [['KILLS', stats.kills], ['DEATHS', stats.deaths], ['K / D', (stats.kills / Math.max(1, stats.deaths)).toFixed(2)], ['HEADSHOT RATE', `${Math.round(stats.headshots / Math.max(1, stats.kills) * 100)}%`], ['ACCURACY', `${Math.min(100, Math.round(stats.hits / Math.max(1, stats.shots) * 100))}%`], ['WINS', stats.wins], ['ROUNDS', stats.rounds], ['BOMBS PLANTED', stats.planted], ['BOMBS DEFUSED', stats.defused], ['FAVORITE WEAPON', favorite ? WEAPONS[favorite].name : 'NONE'], ['LOCKER VALUE', credits(this.profile.items.reduce((sum, item) => sum + itemValue(item), 0))], ['SHOTS FIRED', stats.shots]];
      body.innerHTML = `<div class="section-heading"><h3>LIFETIME SERVICE RECORD</h3><span>LOCAL PROFILE</span></div><dl class="statistics-grid">${rows.map(([name, value]) => `<div><dt>${name}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
    }
    document.getElementById('page-count')!.textContent = `${this.page + 1} / ${pages}`;
    (document.getElementById('page-back') as HTMLButtonElement).disabled = this.page === 0;
    (document.getElementById('page-next') as HTMLButtonElement).disabled = this.page >= pages - 1;
    refreshIcons();
  }

  private odds(caseId: string) {
    const crate = CASES.find(crate => crate.id === caseId)!;
    const regular = RARITIES.slice(0, 6).reduce((sum, rarity) => sum + rarity.weight, 0);
    return RARITIES.map((rarity, index) => `<span style="color:${rarity.color}">${rarity.name}<b>${((index === 6 ? crate.knifeChance : rarity.weight / regular * (1 - crate.knifeChance)) * 100).toFixed(2)}%</b></span>`).join('');
  }

  inspect(item: InventoryItem) {
    this.inspected = item; this.inspector.classList.remove('hidden');
    this.root.classList.add('inspecting'); document.querySelector('main')!.classList.add('studio-active');
    const skin = SKIN_BY_ID.get(item.skinId)!; const rarity = RARITIES[skin.rarity];
    const owned = this.profile.items.some(owned => owned.uid === item.uid);
    this.world.setStudio(item); this.inspector.style.setProperty('--rarity', rarity.color);
    this.rotationButton(true);
    document.getElementById('inspect-serial')!.textContent = `PATTERN ${item.seed.toString().padStart(6, '0')} / ${skin.wrap ? 'SECTION WRAP' : skin.pattern.toUpperCase()}`;
    document.getElementById('inspect-details')!.innerHTML = `<span class="inspect-rarity">${rarity.name.toUpperCase()}${item.statTrak ? ` / STATTRAK ${item.kills}` : ''}</span><h2>${skin.knife ? skin.knife.toUpperCase() : WEAPONS[skin.weapon].name} <span>| ${skin.name}</span></h2><div class="inspect-facts"><div><span>CONDITION</span><b>${wearName(item.float)}</b></div><div><span>FLOAT</span><b>${item.float.toFixed(6)}</b></div><div><span>VALUE</span><b>${credits(itemValue(item))}</b></div></div><div class="wear-track"><i style="left:${item.float * 100}%"></i></div><button class="primary-action" ${owned ? 'data-equip-inspected' : 'data-buy-inspected'}>${icon(owned ? 'check' : 'shopping-cart')} ${owned ? this.profile.equipped[skin.weapon] === item.uid ? 'EQUIPPED' : 'EQUIP' : `ACQUIRE / ${credits(Math.round(itemValue(item) * 1.4))}`}</button>`;
    document.getElementById('inspect-details')!.insertAdjacentHTML('beforeend', '<span class="inspect-notice" id="inspect-notice" role="status"></span>');
    if (owned) document.getElementById('inspect-details')!.insertAdjacentHTML('beforeend', `<label class="charm-control">CHARM<select id="inspect-charm"><option value="">NONE</option>${CHARMS.filter(charm => this.profile.unlockedCharms?.includes(charm.id)).map(charm => `<option value="${charm.id}" ${item.charm === charm.id ? 'selected' : ''}>${charm.name}</option>`).join('')}</select></label>`);
    refreshIcons();
  }

  private skinVisual(item: InventoryItem): LootVisual { const skin = SKIN_BY_ID.get(item.skinId)!; return { name: skin.name, category: skin.knife || WEAPONS[skin.weapon].short, rarity: skin.rarity, image: this.world.thumbnail(skin.weapon, item) }; }
  private charmVisual(id: CharmId): LootVisual { const charm = CHARM_BY_ID.get(id)!; return { name: charm.name, category: 'CHARM', rarity: charm.rarity, image: this.world.charmThumbnail(id) }; }
  private lootCard(drop: LootVisual, winner = false) { return `<div class="reel-item" ${winner ? 'data-reel-winner="true"' : ''} style="--rarity:${drop.gold ? '#e9bd60' : RARITIES[drop.rarity].color}">${drop.gold ? '<span class="rare-question">?</span>' : `<img src="${drop.image}" width="256" height="128" alt="">`}<small>${escapeHtml(drop.category)}</small><b>${escapeHtml(drop.name)}</b></div>`; }
  private async spinReel(title: string, pool: LootVisual[], winner: LootVisual) {
    this.opening = true; this.reel.classList.remove('hidden', 'complete');
    document.getElementById('reel-title')!.textContent = title; document.getElementById('reel-result')!.textContent = 'UNSEALING';
    const track = document.getElementById('reel-track')!; track.style.transform = '';
    track.innerHTML = Array.from({ length: 36 }, (_, index) => this.lootCard(index === 29 ? winner : pool[index % pool.length], index === 29)).join('');
    const width = track.parentElement!.clientWidth; const cardWidth = track.firstElementChild!.getBoundingClientRect().width; const endpoint = width / 2 - (29 * (cardWidth + 8) + cardWidth / 2);
    const animation = track.animate([{ transform: `translateX(${width / 2}px)` }, { transform: `translateX(${endpoint}px)` }], { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 400 : 4800, easing: 'cubic-bezier(.08,.64,.12,1)', fill: 'forwards' });
    this.reelAnimation = animation; document.getElementById('reel-skip')!.classList.remove('hidden'); this.onSound(false);
    try { await animation.finished; } catch {}
    track.style.transform = `translateX(${endpoint}px)`; animation.cancel(); this.reelAnimation = null; document.getElementById('reel-skip')!.classList.add('hidden'); this.opening = false; this.reel.classList.add('complete');
  }
  private async revealLoot(title: string, pool: LootVisual[], winner: LootVisual, finish: () => void) {
    const gold: LootVisual = { name: 'RARE VAULT', category: 'SPECIAL ITEM', rarity: 6, gold: true };
    await this.spinReel(title, pool.map(drop => rareReveal(drop.rarity) ? gold : drop), rareReveal(winner.rarity) ? gold : winner);
    if (!rareReveal(winner.rarity)) { finish(); return; }
    document.getElementById('reel-result')!.innerHTML = `<span class="rare-vault-label">RARE SPECIAL ITEM</span><h3>RARE VAULT</h3><button class="primary-action" id="rare-vault-open">${icon('key-round')}REVEAL RARE ITEM</button>`;
    document.getElementById('rare-vault-open')!.onclick = async () => {
      if (this.opening) return;
      await this.spinReel('RARE VAULT', [...pool.filter(drop => rareReveal(drop.rarity)), winner], winner); finish();
    }; refreshIcons();
  }
  private finishLoot(visual: LootVisual, detail: string, action: string, callback: () => void) {
    document.getElementById('reel-result')!.innerHTML = `<img class="reel-drop" src="${visual.image}" width="256" height="128" alt="${escapeHtml(visual.name)}"><span style="color:${RARITIES[visual.rarity].color}">${RARITIES[visual.rarity].name.toUpperCase()}</span><h3>${escapeHtml(visual.name)}</h3><p>${detail}</p><button class="primary-action" id="reel-inspect">${icon('eye')}${action}</button><button class="text-action" id="reel-done">BACK TO CASES</button>`;
    document.getElementById('reel-inspect')!.onclick = () => { this.reel.classList.add('hidden'); callback(); this.render(); };
    document.getElementById('reel-done')!.onclick = () => { this.reel.classList.add('hidden'); this.render(); }; this.onSound(true); refreshIcons();
  }
  private async unsealCharm(caseId: string) {
    if (this.opening) return; const crate = CHARM_CASES.find(crate => crate.id === caseId)!; const available = crate.charms.filter(id => !this.profile.unlockedCharms?.includes(id));
    const id = openCharmCase(this.profile, caseId); if (!id) { this.notice('CHARM CASE UNAVAILABLE'); return; } this.save();
    const pool = Array.from({ length: Math.min(12, available.length) }, (_, index) => this.charmVisual(available[index])); const winner = this.charmVisual(id);
    await this.revealLoot(crate.name, pool, winner, () => this.finishLoot(winner, 'CHARM UNLOCKED', 'CHOOSE WEAPON', () => this.chooseCharm(id)));
  }
  private async unseal(caseId: string) {
    if (this.opening) return;
    const item = openCase(this.profile, caseId, Math.random, true);
    if (!item) { this.notice('INSUFFICIENT SUPPLY CREDITS'); return; }
    this.save();
    const crate = CASES.find(crate => crate.id === caseId)!;
    const winner = this.skinVisual(item); const pool = Array.from({ length: 12 }, () => this.skinVisual(rollCase(caseId)));
    await this.revealLoot(crate.name, pool, winner, () => this.finishLoot(winner, `${wearName(item.float)} / ${credits(itemValue(item))}`, 'INSPECT DROP', () => this.inspect(item)));
  }

  record(snapshot: Snapshot, id: string) {
    const own = snapshot.players.find(player => player.id === id);
    let changed = false;
    for (const event of snapshot.events) {
      if (event.type === 'shot' && event.id === id && event.weapon !== 'knife') { this.profile.stats.shots++; changed = true; }
      if (event.type === 'hit' && event.id === id) { this.profile.stats.hits++; changed = true; }
      if (event.type === 'kill') {
        if (event.id === id) {
          this.profile.stats.kills++; this.profile.stats.headshots += Number(!!event.head); this.profile.credits += creditReward(snapshot.mode, snapshot.code === 'PRACTICE', event, own?.team);
          if (event.weapon) {
            this.profile.stats.weapons[event.weapon] = (this.profile.stats.weapons[event.weapon] || 0) + 1;
            const item = equippedAppearance(this.profile, event.weapon);
            if (item?.statTrak) { item.kills++; this.onEquip(); }
          }
          changed = true;
        }
        if (event.target === id) { this.profile.stats.deaths++; changed = true; }
      }
      if (event.type === 'round' && own) {
        this.profile.stats.rounds++; this.profile.stats.wins += Number(event.team === own.team);
        this.profile.credits += creditReward(snapshot.mode, snapshot.code === 'PRACTICE', event, own.team); changed = true;
      }
      if (event.type === 'bomb' && event.id === id) {
        if (event.text === 'Bomb planted') this.profile.stats.planted++;
        if (event.text === 'Bomb defused') this.profile.stats.defused++;
        this.profile.credits += creditReward(snapshot.mode, snapshot.code === 'PRACTICE', event, own?.team);
        changed = true;
      }
    }
    if (changed) { this.profile.credits = Math.min(10000000, this.profile.credits); this.save(); }
  }
}