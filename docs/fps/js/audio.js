// ============================================================
// audio.js — WebAudio による効果音の合成（音声ファイルなし）
// ============================================================

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.5;
  }

  /** ユーザー操作の中で呼ぶ必要がある */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  get t() { return this.ctx.currentTime; }

  #noiseBuffer(dur) {
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i += 1) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  #noise(dur, { gain = 0.4, filter = 'lowpass', freq = 1200, q = 1, decay = null, attack = 0.001 } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.#noiseBuffer(dur);
    const bq = this.ctx.createBiquadFilter();
    bq.type = filter;
    bq.frequency.value = freq;
    bq.Q.value = q;
    const g = this.ctx.createGain();
    const t = this.t;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (decay ?? dur));
    src.connect(bq).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
    return { bq, g };
  }

  #tone(freq, dur, { type = 'square', gain = 0.25, to = null, delay = 0 } = {}) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    const t = this.t + delay;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  play(name) {
    if (!this.enabled || !this.ctx) return;
    switch (name) {
      case 'pistol':
        this.#noise(0.16, { gain: 0.5, freq: 2600, decay: 0.13 });
        this.#tone(320, 0.12, { type: 'square', gain: 0.18, to: 70 });
        break;
      case 'shotgun':
        this.#noise(0.42, { gain: 0.75, freq: 1500, decay: 0.34 });
        this.#tone(150, 0.28, { type: 'sawtooth', gain: 0.28, to: 40 });
        this.#noise(0.12, { gain: 0.12, freq: 4200, filter: 'highpass', delay: 0.2 });
        break;
      case 'smg':
        this.#noise(0.09, { gain: 0.36, freq: 3200, decay: 0.07 });
        this.#tone(420, 0.06, { type: 'square', gain: 0.10, to: 120 });
        break;
      case 'empty':
        this.#tone(1800, 0.04, { type: 'square', gain: 0.06, to: 900 });
        break;
      case 'hit':
        this.#noise(0.08, { gain: 0.28, freq: 900, filter: 'bandpass', q: 2, decay: 0.06 });
        break;
      case 'kill':
        this.#tone(180, 0.35, { type: 'sawtooth', gain: 0.26, to: 45 });
        this.#noise(0.3, { gain: 0.3, freq: 700, decay: 0.25 });
        break;
      case 'hurt':
        this.#tone(220, 0.24, { type: 'triangle', gain: 0.3, to: 90 });
        this.#noise(0.18, { gain: 0.2, freq: 500, decay: 0.16 });
        break;
      case 'enemyShoot':
        this.#tone(700, 0.18, { type: 'sawtooth', gain: 0.16, to: 180 });
        break;
      case 'plasmaHit':
        this.#noise(0.12, { gain: 0.22, freq: 2000, filter: 'bandpass', q: 1.5, decay: 0.1 });
        break;
      case 'pickup':
        this.#tone(660, 0.09, { type: 'square', gain: 0.16 });
        this.#tone(990, 0.12, { type: 'square', gain: 0.14, delay: 0.08 });
        break;
      case 'weapon':
        this.#tone(440, 0.1, { type: 'square', gain: 0.16 });
        this.#tone(660, 0.1, { type: 'square', gain: 0.16, delay: 0.09 });
        this.#tone(880, 0.16, { type: 'square', gain: 0.16, delay: 0.18 });
        break;
      case 'switch':
        this.#noise(0.06, { gain: 0.16, freq: 3000, filter: 'highpass', decay: 0.05 });
        break;
      case 'wave':
        this.#tone(330, 0.5, { type: 'sawtooth', gain: 0.16 });
        this.#tone(494, 0.5, { type: 'sawtooth', gain: 0.14, delay: 0.12 });
        this.#tone(660, 0.6, { type: 'sawtooth', gain: 0.12, delay: 0.24 });
        break;
      case 'gameover':
        this.#tone(330, 0.5, { type: 'triangle', gain: 0.22, to: 110 });
        this.#tone(220, 0.8, { type: 'triangle', gain: 0.2, to: 60, delay: 0.25 });
        break;
      case 'growl':
        this.#tone(90 + Math.random() * 40, 0.4, { type: 'sawtooth', gain: 0.1, to: 55 });
        break;
      default:
        break;
    }
  }
}
