import type { GameWorld } from './world.ts';
import { refreshIcons } from './armory.ts';

export type CrosshairOptions = { color: string; gap: number; thickness: number; length: number; dot: boolean; outline: boolean; style: 'static' | 'dynamic' | 'dot' };
export const DEFAULT_CROSSHAIR: CrosshairOptions = { color: '#a9e6bb', gap: 4, thickness: 2, length: 7, dot: false, outline: true, style: 'static' };
export function parseCrosshair(value: unknown): CrosshairOptions {
  const input = value && typeof value === 'object' ? value as Partial<CrosshairOptions> : {};
  const bounded = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  return { color: typeof input.color === 'string' && /^#[\da-f]{6}$/i.test(input.color) ? input.color : DEFAULT_CROSSHAIR.color,
    gap: bounded(input.gap, 4, 0, 16), thickness: bounded(input.thickness, 2, 1, 6), length: bounded(input.length, 7, 1, 20),
    dot: typeof input.dot === 'boolean' ? input.dot : false, outline: typeof input.outline === 'boolean' ? input.outline : true,
    style: input.style === 'dynamic' || input.style === 'dot' ? input.style : 'static' };
}

export class SettingsController {
  sensitivity = 1;
  reducedFlashes = false;
  crosshair = { ...DEFAULT_CROSSHAIR };
  private fov = 77;
  private quality: 'high' | 'medium' | 'low' = 'high';
  private hitboxes = false;
  private root: HTMLElement;
  private targets: HTMLElement[];

  constructor(private world: GameWorld, crosshair: HTMLElement) {
    this.root = document.getElementById('settings-overlay')!;
    try {
      this.crosshair = parseCrosshair(JSON.parse(localStorage.getItem('bs-crosshair-v2') || 'null'));
      this.sensitivity = Math.min(3, Math.max(0.2, Number(localStorage.getItem('bs-sensitivity')) || 1));
      this.fov = Math.min(105, Math.max(65, Number(localStorage.getItem('bs-fov')) || 77));
      const quality = localStorage.getItem('bs-quality'); if (quality === 'low' || quality === 'medium') this.quality = quality;
      this.hitboxes = localStorage.getItem('bs-hitboxes') === 'true';
      this.reducedFlashes = localStorage.getItem('bs-reduced-flashes') === 'true';
    } catch {}
    const slider = (name: string, label: string, min: number, max: number, step: number, value: number) => `<label class="setting-row">${label}<output id="${name}-readout">${value}</output><input data-setting="${name}" id="${name}-setting" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
    this.root.innerHTML = `<div class="settings-panel"><header><div><span class="eyebrow">OPERATOR CONFIGURATION</span><h2>SETTINGS</h2></div><button class="icon-button" id="settings-close" title="Close settings" aria-label="Close settings"><i data-lucide="x"></i></button></header><div class="settings-scroll">${slider('sensitivity', 'MOUSE SENSITIVITY', 0.2, 3, 0.05, this.sensitivity)}${slider('fov', 'FIELD OF VIEW', 65, 105, 1, this.fov)}<label class="setting-row">RENDER QUALITY<select id="quality-setting"><option value="high">HIGH / SHADOWS</option><option value="medium">MEDIUM</option><option value="low">LOW / PERFORMANCE</option></select></label><div class="settings-subhead"><h3>CROSSHAIR</h3><div class="crosshair-preview"><div class="crosshair" id="crosshair-preview"><i></i><i></i><i></i><i></i><b></b></div></div></div><div class="crosshair-styles" role="group" aria-label="Crosshair style">${(['static', 'dynamic', 'dot'] as const).map(style => `<label><input type="radio" name="crosshair-style" value="${style}" ${this.crosshair.style === style ? 'checked' : ''}>${style === 'dot' ? 'DOT ONLY' : style.toUpperCase()}</label>`).join('')}</div><div class="color-swatches" aria-label="Crosshair color">${['#a9e6bb', '#80d4d3', '#ffffff', '#ee817b', '#f6d771'].map(color => `<button data-color="${color}" style="--swatch:${color}" title="${color}" aria-label="Crosshair ${color}"></button>`).join('')}<input type="color" id="crosshair-custom" value="${this.crosshair.color}" aria-label="Custom crosshair color"></div>${slider('gap', 'GAP', 0, 16, 1, this.crosshair.gap)}${slider('length', 'LENGTH', 1, 20, 1, this.crosshair.length)}${slider('thickness', 'THICKNESS', 1, 6, 1, this.crosshair.thickness)}<div class="setting-toggles"><label><input type="checkbox" id="crosshair-dot" ${this.crosshair.dot ? 'checked' : ''}>CENTER DOT</label><label><input type="checkbox" id="crosshair-outline" ${this.crosshair.outline ? 'checked' : ''}>OUTLINE</label></div></div><button class="settings-reset" id="settings-reset"><i data-lucide="rotate-ccw"></i> RESET DEFAULTS</button></div>`;
    this.root.querySelector('.settings-scroll')!.insertAdjacentHTML('beforeend', `<label class="debug-toggle"><input type="checkbox" id="hitbox-debug" ${this.hitboxes ? 'checked' : ''}>LOCAL HITBOX DEBUG</label>`);
    this.root.querySelector('.settings-scroll')!.insertAdjacentHTML('beforeend', `<label class="debug-toggle"><input type="checkbox" id="reduced-flashes" ${this.reducedFlashes ? 'checked' : ''}>REDUCED FLASH EFFECT</label>`);
    this.targets = [crosshair, document.getElementById('crosshair-preview')!];
    (document.getElementById('quality-setting') as HTMLSelectElement).value = this.quality;
    this.root.addEventListener('input', event => {
      const input = event.target as HTMLInputElement;
      const setting = input.dataset.setting;
      if (setting) {
        const value = Number(input.value);
        if (setting === 'sensitivity') this.sensitivity = value;
        else if (setting === 'fov') this.fov = value;
        else this.crosshair[setting as 'gap' | 'length' | 'thickness'] = value;
        document.getElementById(`${setting}-readout`)!.textContent = input.value;
      }
      if (input.name === 'crosshair-style') this.crosshair.style = input.value as CrosshairOptions['style'];
      if (input.id === 'crosshair-dot') this.crosshair.dot = input.checked;
      if (input.id === 'crosshair-outline') this.crosshair.outline = input.checked;
      if (input.id === 'crosshair-custom') this.crosshair.color = input.value;
      if (input.id === 'quality-setting') this.quality = input.value as typeof this.quality;
      if (input.id === 'hitbox-debug') this.hitboxes = input.checked;
      if (input.id === 'reduced-flashes') this.reducedFlashes = input.checked;
      this.apply();
    });
    this.root.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (button?.dataset.color) { this.crosshair.color = button.dataset.color; (document.getElementById('crosshair-custom') as HTMLInputElement).value = this.crosshair.color; this.apply(); }
      if (button?.id === 'settings-close') this.hide();
      if (button?.id === 'settings-reset') this.reset();
    });
    this.apply();
  }

  get isOpen() { return !this.root.classList.contains('hidden'); }
  show() { if (document.pointerLockElement) document.exitPointerLock(); this.root.classList.remove('hidden'); document.getElementById('settings-close')!.focus(); }
  hide() { this.root.classList.add('hidden'); }
  private apply() {
    this.world.setFov(this.fov); this.world.setQuality(this.quality);
    this.world.setHitboxes(this.hitboxes);
    this.update(false, 0);
    try {
      localStorage.setItem('bs-crosshair-v2', JSON.stringify(this.crosshair)); localStorage.setItem('bs-sensitivity', String(this.sensitivity));
      localStorage.setItem('bs-fov', String(this.fov)); localStorage.setItem('bs-quality', this.quality);
      localStorage.setItem('bs-hitboxes', String(this.hitboxes));
      localStorage.setItem('bs-reduced-flashes', String(this.reducedFlashes));
    } catch {}
    refreshIcons();
  }
  update(moving: boolean, heat: number) {
    for (const target of this.targets) {
      const dynamic = this.crosshair.style === 'dynamic' ? (moving ? 4 : 0) + heat * 4 : 0;
      target.style.setProperty('--ch-color', this.crosshair.color); target.style.setProperty('--ch-gap', `${this.crosshair.gap + dynamic}px`);
      target.style.setProperty('--ch-length', `${this.crosshair.length}px`); target.style.setProperty('--ch-thickness', `${this.crosshair.thickness}px`);
      target.classList.toggle('dot-only', this.crosshair.style === 'dot'); target.classList.toggle('with-dot', this.crosshair.dot || this.crosshair.style === 'dot');
      target.classList.toggle('with-outline', this.crosshair.outline);
    }
  }
  private reset() {
    this.crosshair = { ...DEFAULT_CROSSHAIR }; this.sensitivity = 1; this.fov = 77; this.quality = 'high';
    this.reducedFlashes = false; (document.getElementById('reduced-flashes') as HTMLInputElement).checked = false;
    for (const [key, value] of Object.entries({ sensitivity: 1, fov: 77, gap: 4, length: 7, thickness: 2 })) {
      (document.getElementById(`${key}-setting`) as HTMLInputElement).value = String(value); document.getElementById(`${key}-readout`)!.textContent = String(value);
    }
    (document.getElementById('quality-setting') as HTMLSelectElement).value = 'high';
    (document.getElementById('crosshair-dot') as HTMLInputElement).checked = false;
    (document.getElementById('crosshair-outline') as HTMLInputElement).checked = true;
    this.root.querySelector<HTMLInputElement>('input[name=crosshair-style][value=static]')!.checked = true;
    (document.getElementById('crosshair-custom') as HTMLInputElement).value = this.crosshair.color;
    this.apply();
  }
}