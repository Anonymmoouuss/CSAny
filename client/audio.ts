import type { WeaponId } from '../shared/game.ts';

export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private environmentFilter: BiquadFilterNode | null = null;
  private flashLevel = -1;
  private noise: AudioBuffer | null = null;
  muted = localStorage.getItem('bs-muted') === 'true';

  async unlock() {
    if (!this.context) {
      this.context = new AudioContext(); this.master = this.context.createGain(); this.master.connect(this.context.destination);
      this.environmentFilter = this.context.createBiquadFilter(); this.environmentFilter.type = 'lowpass'; this.environmentFilter.frequency.value = 22000; this.environmentFilter.connect(this.master);
      this.noise = this.context.createBuffer(1, this.context.sampleRate * 0.5, this.context.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
      this.master.gain.value = this.muted ? 0 : 0.28;
    }
    await this.context.resume();
  }

  toggle() {
    this.muted = !this.muted; localStorage.setItem('bs-muted', String(this.muted));
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.28;
    return this.muted;
  }

  private tone(frequency: number, duration: number, volume: number, type: OscillatorType = 'sine', delay = 0, clear = false) {
    if (!this.context || !this.master) return;
    const oscillator = this.context.createOscillator(); const gain = this.context.createGain();
    const now = this.context.currentTime + delay;
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(volume, now); gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain); gain.connect(clear ? this.master : this.environmentFilter || this.master); oscillator.start(now); oscillator.stop(now + duration);
  }

  private burst(duration: number, frequency: number, volume: number) {
    if (!this.context || !this.master || !this.noise) return;
    const source = this.context.createBufferSource(); const gain = this.context.createGain(); const filter = this.context.createBiquadFilter();
    const now = this.context.currentTime;
    source.buffer = this.noise; filter.type = 'lowpass'; filter.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, now); gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter); filter.connect(gain); gain.connect(this.environmentFilter || this.master); source.start(now); source.stop(now + duration);
  }

  shot(weapon: WeaponId, distant = false) {
    const volume = distant ? 0.18 : 0.8;
    if (weapon === 'knife') { this.melee(distant); return; }
    this.burst(weapon === 'sniper' ? 0.35 : 0.18, weapon === 'pistol' ? 4200 : 2200, volume);
    this.tone(weapon === 'sniper' ? 65 : 110, 0.16, volume * 0.8, 'triangle');
  }
  hit(head: boolean, kill = false) {
    this.tone(head ? 2100 : 850, head ? 0.23 : 0.08, 0.3, 'triangle');
    if (head) this.tone(3200, 0.12, 0.16, 'sine', 0.015);
    if (kill) this.tone(520, 0.16, 0.2, 'sine', 0.07);
  }
  footstep() { this.burst(0.065, 650, 0.18); }
  melee(distant = false) { this.burst(0.12, 1600, distant ? 0.045 : 0.19); }
  reload() { this.burst(0.06, 2800, 0.22); this.tone(430, 0.08, 0.1, 'square', 0.3); this.tone(620, 0.06, 0.1, 'square', 1.1); }
  round(win: boolean) { [0, 0.16, 0.32].forEach((delay, index) => this.tone((win ? [440, 554, 660] : [330, 294, 220])[index], 0.4, 0.25, 'triangle', delay)); }
  click() { this.tone(650, 0.04, 0.12, 'triangle'); }
  damage() { this.burst(0.12, 450, 0.4); }
  beep(urgent = false) { this.tone(urgent ? 1800 : 1350, 0.065, urgent ? 0.25 : 0.16, 'sine'); }
  explosion() { this.burst(0.9, 350, 1); this.tone(45, 0.8, 0.9, 'sine'); }
  flashbang(strength = 1) { this.burst(0.16, 6000, 0.25 + strength * 0.3); if (strength > 0) this.tone(2850, 0.8 + strength * 1.7, 0.055 * strength, 'sine', 0, true); }
  updateFlash(level: number) {
    if (!this.context || !this.environmentFilter || Math.abs(level - this.flashLevel) < 0.02) return;
    this.flashLevel = level; const now = this.context.currentTime; this.environmentFilter.frequency.cancelScheduledValues(now);
    this.environmentFilter.frequency.setTargetAtTime(22000 - Math.pow(Math.max(0, Math.min(1, level)), 0.6) * 21200, now, 0.06);
  }
}