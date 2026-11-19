// Procedural sound effects with WebAudio (no asset files needed).
// play(name, distance) attenuates by distance; the rotor is a looping hum.

export class Audio {
  constructor() {
    this.ctx = null; this.master = null; this.enabled = true; this.volume = 0.6;
    this.last = {};
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    // white noise buffer reused by every noisy effect
    const len = this.ctx.sampleRate * 1.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startRotor();
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  startRotor() {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
    const g = c.createGain(); g.gain.value = 0.0;
    const lfo = c.createOscillator(); lfo.frequency.value = 11;
    const lfoGain = c.createGain(); lfoGain.gain.value = 0.12;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(lp).connect(g).connect(this.master);
    src.start(); lfo.start();
    this.rotor = { g, lfo, lp, base: 0 };
  }

  // Rotor intensity follows throttle/speed; 0 mutes it (menus).
  setRotor(level, speed) {
    if (!this.rotor) return;
    const t = this.ctx.currentTime;
    this.rotor.g.gain.setTargetAtTime(0.18 * level, t, 0.1);
    this.rotor.lfo.frequency.setTargetAtTime(10 + speed * 0.06, t, 0.2);
    this.rotor.lp.frequency.setTargetAtTime(160 + speed * 2, t, 0.2);
  }

  noiseBurst(dur, freq, q, vol, type = 'lowpass', sweepTo = null) {
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  tone(dur, f0, f1, vol, type = 'square') {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  play(name, dist = 0) {
    if (!this.ctx || !this.enabled || this.ctx.state !== 'running') return;
    // rate-limit identical sounds so 13 shots/s don't saturate the mixer
    const now = this.ctx.currentTime, minGap = name === 'gun' ? 0.06 : 0.03;
    if (this.last[name] && now - this.last[name] < minGap) return;
    this.last[name] = now;
    const a = Math.max(0.05, 1 - dist / 700);
    switch (name) {
      case 'gun': this.noiseBurst(0.07, 1800, 0.8, 0.35, 'bandpass'); break;
      case 'egun': this.noiseBurst(0.06, 1300, 1, 0.25 * a, 'bandpass'); break;
      case 'rocket': this.noiseBurst(0.6, 2500, 0.6, 0.35, 'lowpass', 400); break;
      case 'launch': this.noiseBurst(1.0, 1500, 0.7, 0.4 * a, 'lowpass', 200); break;
      case 'shell': this.noiseBurst(0.35, 600, 0.8, 0.4 * a); break;
      case 'boom': this.noiseBurst(0.9, 500, 0.7, 0.7 * a, 'lowpass', 60); break;
      case 'bigboom': this.noiseBurst(1.6, 400, 0.7, 0.9 * a, 'lowpass', 40); this.tone(0.8, 90, 30, 0.4 * a, 'sine'); break;
      case 'hit': this.noiseBurst(0.15, 3000, 2, 0.35, 'highpass'); this.tone(0.12, 180, 90, 0.15); break;
      case 'flare': this.noiseBurst(0.3, 4000, 1, 0.2, 'highpass'); break;
      case 'pickup': this.tone(0.12, 660, 990, 0.15, 'triangle'); setTimeout(() => this.tone(0.18, 990, 1320, 0.15, 'triangle'), 90); break;
      case 'warn': this.tone(0.12, 1400, 1400, 0.12, 'square'); break;
      case 'lock': this.tone(0.06, 900, 900, 0.07, 'square'); break;
      case 'wave': this.tone(0.3, 440, 880, 0.15, 'sawtooth'); break;
    }
  }
}
