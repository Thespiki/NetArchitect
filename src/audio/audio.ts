// 100% procedural audio (Web Audio): slow synthwave that speeds up with the tension, the hum of
// the server racks and interface sounds. No audio file.

export type Sfx =
  | 'click'
  | 'place'
  | 'cable'
  | 'remove'
  | 'error'
  | 'alert'
  | 'repair'
  | 'success'
  | 'fail'
  | 'launch'
  | 'toggle'
  | 'buy';

type Mode = 'menu' | 'build' | 'live';

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

// A minor: Am – F – C – G, one bar per chord.
const CHORDS = [
  { root: 45, notes: [57, 60, 64] },
  { root: 41, notes: [53, 57, 60] },
  { root: 48, notes: [55, 60, 64] },
  { root: 43, notes: [55, 59, 62] },
];

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private padFilter!: BiquadFilterNode;
  private reverbSend!: GainNode;
  private delaySend!: GainNode;
  private noise!: AudioBuffer;
  private humGain: GainNode | null = null;
  private fanGain: GainNode | null = null;
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  private bpm = 84;
  private smooth = 0.1;
  private lastSfx = new Map<Sfx, number>();
  private target = 0.1;
  private humLevel = 0;
  private mode: Mode = 'menu';
  muted = false;
  volume = 0.7;

  get ready(): boolean {
    return !!this.ctx;
  }

  /** Call from a user gesture (browser autoplay policy). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }
    const ctx = this.ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(comp).connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.3;
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.45;
    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0.5;
    for (const b of [this.musicBus, this.sfxBus, this.ambBus]) b.connect(this.master);

    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 900;
    this.padFilter.Q.value = 0.7;
    this.padFilter.connect(this.musicBus);

    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse(2.4);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(reverb).connect(this.musicBus);

    const delay = ctx.createDelay(2);
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0.3;
    this.delaySend.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(this.musicBus);
    delay.delayTime.value = 0.54;

    this.noise = this.noiseBuffer();
    this.startAmbience();
    this.nextTime = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    if (mode !== 'live') this.target = mode === 'menu' ? 0.08 : 0.16;
    this.updateAmbience();
  }

  /** Musical tension 0 → 1 (frustration, failures, attacks). */
  setIntensity(x: number): void {
    this.target = Math.max(0, Math.min(1, x));
  }

  /** Average network load: modulates the hum of the racks. */
  setHum(level: number): void {
    this.humLevel = Math.max(0, Math.min(1, level));
    this.updateAmbience();
  }

  dispose(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    void this.ctx?.close();
    this.ctx = null;
  }

  // -------------------------------------------------------------------------

  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6;
    }
    return buf;
  }

  private noiseBuffer(): AudioBuffer {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private startAmbience(): void {
    const ctx = this.ctx!;
    // Filtered brown noise: the low rumble of the racks.
    const len = ctx.sampleRate * 3;
    const brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = brown;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    src.connect(lp).connect(this.humGain).connect(this.ambBus);
    src.start();
    // Fans: narrow-band white noise, very quiet.
    const fan = ctx.createBufferSource();
    fan.buffer = this.noise;
    fan.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 850;
    bp.Q.value = 1.4;
    this.fanGain = ctx.createGain();
    this.fanGain.gain.value = 0;
    fan.connect(bp).connect(this.fanGain).connect(this.ambBus);
    fan.start();
    // 50 Hz mains hum.
    const mains = ctx.createOscillator();
    mains.frequency.value = 50;
    const mg = ctx.createGain();
    mg.gain.value = 0.018;
    mains.connect(mg).connect(this.humGain);
    mains.start();
    this.updateAmbience();
  }

  private updateAmbience(): void {
    if (!this.ctx || !this.humGain || !this.fanGain) return;
    const t = this.ctx.currentTime;
    const base = this.mode === 'menu' ? 0 : this.mode === 'build' ? 0.35 : 0.45 + 0.4 * this.humLevel;
    this.humGain.gain.setTargetAtTime(base, t, 0.6);
    this.fanGain.gain.setTargetAtTime(this.mode === 'menu' ? 0 : 0.02 + 0.05 * this.humLevel, t, 0.6);
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime);
      this.smooth += (this.target - this.smooth) * 0.04;
      const targetBpm = 84 + 36 * this.smooth;
      this.bpm += (targetBpm - this.bpm) * 0.05;
      this.nextTime += 60 / this.bpm / 4;
      this.step = (this.step + 1) % 64;
    }
  }

  private playStep(step: number, t: number): void {
    const i = this.smooth;
    const beatLen = 60 / this.bpm;
    const chord = CHORDS[Math.floor(step / 16) % CHORDS.length];
    const inBar = step % 16;
    this.padFilter.frequency.setTargetAtTime(700 + 2200 * i, t, 0.3);
    if (inBar === 0) this.pad(chord.notes, t, beatLen * 4);
    if (inBar % 2 === 0) this.bass(chord.root + (inBar % 8 === 6 ? 12 : 0), t, i);
    if (i > 0.28) {
      const tones = [chord.notes[0], chord.notes[1], chord.notes[2], chord.notes[0] + 12];
      const n = tones[(inBar + Math.floor(step / 16)) % tones.length] + 12;
      if (inBar % (i > 0.6 ? 1 : 2) === 0) this.pluck(n, t, 0.035 + 0.03 * i);
    }
    if (i > 0.42) {
      const fourFloor = i > 0.6;
      if (inBar % 4 === 0 && (fourFloor || inBar % 8 === 0)) this.kick(t);
      if (inBar === 4 || inBar === 12) this.snare(t);
      if (inBar % 2 === 1 || i > 0.75) this.hat(t, inBar % 2 === 1 ? 0.05 : 0.025);
    }
    if (i > 0.8 && inBar === 0 && Math.floor(step / 16) % 2 === 1) this.siren(t, beatLen * 2);
  }

  private pad(notes: number[], t: number, dur: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.7);
    g.gain.setValueAtTime(0.06, t + dur - 0.1);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.9);
    g.connect(this.padFilter);
    g.connect(this.reverbSend);
    for (const n of notes) {
      for (const detune of [-8, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = detune;
        o.connect(g);
        o.start(t);
        o.stop(t + dur + 1);
      }
    }
  }

  private bass(n: number, t: number, i: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = midi(n);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 5;
    f.frequency.setValueAtTime(260 + 900 * i, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    o.connect(f).connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.3);
  }

  private pluck(n: number, t: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = midi(n);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(f).connect(g);
    g.connect(this.musicBus);
    g.connect(this.delaySend);
    o.start(t);
    o.stop(t + 0.2);
  }

  private kick(t: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.35);
  }

  private noiseHit(t: number, type: BiquadFilterType, freq: number, vol: number, dur: number, reverb = 0): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.musicBus);
    if (reverb) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      g.connect(s).connect(this.reverbSend);
    }
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private snare(t: number): void {
    this.noiseHit(t, 'highpass', 1400, 0.22, 0.18, 1.2);
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.15);
  }

  private hat(t: number, vol: number): void {
    this.noiseHit(t, 'highpass', 7500, vol, 0.045);
  }

  private siren(t: number, dur: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(midi(76), t);
    o.frequency.linearRampToValueAtTime(midi(77), t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.03, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.musicBus);
    g.connect(this.reverbSend);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // -------------------------------------------------------------------------
  // Sound effects

  sfx(name: Sfx): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - (this.lastSfx.get(name) ?? -1) < 0.06) return;
    this.lastSfx.set(name, now);
    const tone = (freq: number, at: number, dur: number, type: OscillatorType, vol: number, to?: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, now + at);
      if (to) o.frequency.exponentialRampToValueAtTime(to, now + at + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now + at);
      g.gain.exponentialRampToValueAtTime(vol, now + at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
      o.connect(g).connect(this.sfxBus);
      o.start(now + at);
      o.stop(now + at + dur + 0.02);
    };
    switch (name) {
      case 'click':
        tone(1300, 0, 0.03, 'triangle', 0.08);
        break;
      case 'toggle':
        tone(320, 0, 0.18, 'sine', 0.12, 640);
        break;
      case 'place':
        tone(520, 0, 0.09, 'square', 0.07, 780);
        break;
      case 'cable':
        tone(660, 0, 0.05, 'triangle', 0.12);
        tone(990, 0.06, 0.07, 'triangle', 0.12);
        break;
      case 'remove':
        tone(420, 0, 0.14, 'sawtooth', 0.06, 140);
        break;
      case 'error':
        tone(140, 0, 0.16, 'square', 0.08);
        tone(146, 0, 0.16, 'square', 0.06);
        break;
      case 'alert':
        for (let k = 0; k < 3; k++) tone(k % 2 ? 660 : 880, k * 0.11, 0.09, 'square', 0.07);
        break;
      case 'repair':
        [72, 76, 79, 84].forEach((n, k) => tone(midi(n), k * 0.07, 0.12, 'sine', 0.12));
        break;
      case 'buy':
        [69, 76, 81].forEach((n, k) => tone(midi(n), k * 0.06, 0.14, 'triangle', 0.12));
        break;
      case 'success':
        [69, 72, 76, 81, 84].forEach((n, k) => tone(midi(n), k * 0.1, 0.35, 'triangle', 0.13));
        break;
      case 'fail':
        [69, 65, 62, 57].forEach((n, k) => tone(midi(n), k * 0.16, 0.3, 'sawtooth', 0.06));
        break;
      case 'launch': {
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.Q.value = 3;
        f.frequency.setValueAtTime(200, now);
        f.frequency.exponentialRampToValueAtTime(2400, now + 0.6);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.25, now + 0.3);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
        src.connect(f).connect(g).connect(this.sfxBus);
        src.start(now);
        src.stop(now + 0.75);
        [57, 64, 69].forEach((n) => tone(midi(n), 0.25, 0.8, 'sawtooth', 0.04));
        break;
      }
    }
  }
}
