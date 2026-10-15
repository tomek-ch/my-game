import Phaser from 'phaser';
import { TUNING } from '../tuning.js';

const A = TUNING.audio;
const NOOP = { stop() {} };
const MUTE_KEY = 'my-game:muted';

// Every sound is synthesized with Web Audio: oscillators and filtered noise with short envelopes.
// Sounds placed in the world (x, y) get quieter with distance from the listener and pan left/right.
class Sfx {
  constructor() {
    this.ctx = null;
    this.listener = null;
    this.last = new Map();
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      this.muted = false;
    }
  }

  // Shares Phaser's AudioContext, which Phaser unlocks on the first input. Safe to call per scene.
  init(ctx) {
    if (this.ctx || !ctx) return;
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : A.master;
    const comp = ctx.createDynamicsCompressor(); // keeps big pileups from clipping
    this.master.connect(comp).connect(ctx.destination);

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : A.master;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      // storage unavailable; mute just won't persist
    }
  }

  // ---- Sounds -------------------------------------------------------------------------------

  swing(finisher) {
    return this.play('swing', null, null, 0, (o) => [
      this.noise(o, { freq: 3200, to: 700, q: 1.4, dur: finisher ? 0.22 : 0.12, vol: finisher ? 0.45 : 0.3 }),
      finisher && this.tone(o, { type: 'triangle', freq: 240, to: 90, dur: 0.2, vol: 0.12 }),
    ]);
  }

  hit(heavy) {
    return this.play('hit', null, null, 25, (o) => [
      this.tone(o, { freq: heavy ? 130 : 170, to: heavy ? 35 : 50, dur: heavy ? 0.16 : 0.09, vol: heavy ? 0.9 : 0.6 }),
      this.noise(o, { filter: 'highpass', freq: 2000, dur: 0.03, vol: 0.3 }),
      heavy && this.noise(o, { filter: 'lowpass', freq: 900, to: 200, dur: 0.14, vol: 0.45 }),
    ]);
  }

  kill(x, y) {
    return this.play('kill', x, y, 30, (o) => [
      this.noise(o, { filter: 'lowpass', freq: 1400, to: 200, dur: 0.26, vol: 0.5 }),
      this.tone(o, { type: 'square', freq: 320, to: 60, dur: 0.18, vol: 0.1 }),
    ]);
  }

  shoot() {
    return this.play('shoot', null, null, 0, (o) => [
      this.tone(o, { type: 'square', freq: 900, to: 320, dur: 0.08, vol: 0.08 }),
      this.noise(o, { filter: 'highpass', freq: 4000, dur: 0.03, vol: 0.1 }),
    ]);
  }

  boltHit(x, y) {
    return this.play('boltHit', x, y, 30, (o) => [
      this.tone(o, { freq: 1400, to: 700, dur: 0.05, vol: 0.12 }),
      this.noise(o, { freq: 2500, dur: 0.03, vol: 0.18 }),
    ]);
  }

  deflect(x, y) {
    return this.play('deflect', x, y, 40, (o) => [
      this.tone(o, { freq: 1800, to: 2400, dur: 0.07, vol: 0.12 }),
      this.tone(o, { type: 'triangle', freq: 2700, dur: 0.1, vol: 0.06, delay: 0.01 }),
    ]);
  }

  dash() {
    return this.play('dash', null, null, 0, (o) => [
      this.noise(o, { freq: 400, to: 2400, q: 0.8, dur: 0.15, vol: 0.35 }),
      this.tone(o, { freq: 300, to: 600, dur: 0.1, vol: 0.05 }),
    ]);
  }

  dashReady() {
    return this.play('dashReady', null, null, 0, (o) => [
      this.tone(o, { freq: 1320, dur: 0.05, vol: 0.05 }),
      this.tone(o, { freq: 1760, dur: 0.06, vol: 0.05, delay: 0.045 }),
    ]);
  }

  hurt() {
    return this.play('hurt', null, null, 0, (o) => [
      this.tone(o, { type: 'sawtooth', freq: 220, to: 70, dur: 0.22, vol: 0.2 }),
      this.tone(o, { freq: 95, to: 40, dur: 0.2, vol: 0.7 }),
      this.noise(o, { filter: 'lowpass', freq: 1600, dur: 0.15, vol: 0.45 }),
    ]);
  }

  death() {
    return this.play('death', null, null, 0, (o) => [
      this.tone(o, { type: 'sawtooth', freq: 300, to: 40, dur: 0.9, vol: 0.22 }),
      this.tone(o, { freq: 110, to: 30, dur: 0.6, vol: 0.7 }),
      this.noise(o, { filter: 'lowpass', freq: 1000, to: 100, dur: 0.7, vol: 0.4 }),
    ]);
  }

  // Rising whine for the length of the charger's telegraph.
  chargerTelegraph(x, y, dur) {
    return this.play('chargerTelegraph', x, y, 0, (o) => [
      this.tone(o, { type: 'square', freq: 200, to: 800, dur, vol: 0.05, attack: 0.05 }),
    ]);
  }

  chargerLaunch(x, y) {
    return this.play('chargerLaunch', x, y, 0, (o) => [
      this.noise(o, { freq: 600, to: 2000, dur: 0.22, vol: 0.35 }),
      this.tone(o, { type: 'sawtooth', freq: 160, to: 90, dur: 0.2, vol: 0.1 }),
    ]);
  }

  shooterCharge(x, y, dur) {
    return this.play('shooterCharge', x, y, 0, (o) => [
      this.tone(o, { freq: 300, to: 900, dur, vol: 0.06, attack: 0.05 }),
    ]);
  }

  shooterFire(x, y) {
    return this.play('shooterFire', x, y, 30, (o) => [
      this.tone(o, { freq: 700, to: 250, dur: 0.14, vol: 0.16 }),
      this.tone(o, { type: 'square', freq: 350, to: 120, dur: 0.1, vol: 0.04 }),
    ]);
  }

  // Low rumble that swells over the brute's windup.
  bruteWindup(x, y, dur) {
    return this.play('bruteWindup', x, y, 0, (o) => [
      this.tone(o, { type: 'triangle', freq: 60, to: 130, dur, vol: 0.3, attack: dur * 0.8 }),
      this.noise(o, { filter: 'lowpass', freq: 250, to: 500, dur, vol: 0.2, attack: dur * 0.8 }),
    ]);
  }

  bruteSwing(x, y) {
    return this.play('bruteSwing', x, y, 0, (o) => [
      this.noise(o, { freq: 1500, to: 250, q: 0.7, dur: 0.32, vol: 0.6 }),
      this.tone(o, { freq: 85, to: 35, dur: 0.3, vol: 0.7 }),
    ]);
  }

  // Grunt and whoosh as the brute leaps.
  bruteJump(x, y) {
    return this.play('bruteJump', x, y, 0, (o) => [
      this.noise(o, { freq: 300, to: 1400, q: 0.8, dur: 0.35, vol: 0.35, attack: 0.08 }),
      this.tone(o, { type: 'triangle', freq: 90, to: 180, dur: 0.18, vol: 0.25 }),
    ]);
  }

  // Ground-shaking thud when the brute lands.
  bruteSlam(x, y) {
    return this.play('bruteSlam', x, y, 0, (o) => [
      this.tone(o, { freq: 70, to: 28, dur: 0.45, vol: 0.9 }),
      this.noise(o, { filter: 'lowpass', freq: 1200, to: 150, dur: 0.4, vol: 0.7 }),
      this.noise(o, { filter: 'highpass', freq: 2500, dur: 0.05, vol: 0.25 }),
    ]);
  }

  // Metallic clang when a finisher staggers a brute.
  bruteStagger(x, y) {
    return this.play('bruteStagger', x, y, 0, (o) => [
      this.tone(o, { type: 'square', freq: 523, dur: 0.3, vol: 0.06 }),
      this.tone(o, { type: 'square', freq: 787, dur: 0.25, vol: 0.05 }),
      this.tone(o, { freq: 1240, dur: 0.18, vol: 0.1 }),
    ]);
  }

  // ---- Synth plumbing -----------------------------------------------------------------------

  // Builds a voice (gain + pan) for a sound, runs `build` to attach sources, and returns a handle
  // whose stop() cuts it short. Skips the sound if audio isn't running or it played < gapMs ago.
  play(name, x, y, gapMs, build) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.muted) return NOOP;
    const now = performance.now();
    if (now - (this.last.get(name) ?? -Infinity) < gapMs) return NOOP;
    this.last.set(name, now);

    let vol = 1;
    let pan = 0;
    if (x != null && this.listener) {
      const dx = x - this.listener.x;
      const dist = Math.hypot(dx, y - this.listener.y);
      vol = Phaser.Math.Clamp(1 - (dist - A.fullVolumeRange) / A.falloffRange, A.minWorldVolume, 1);
      pan = Phaser.Math.Clamp(dx / A.panRange, -0.8, 0.8);
    }
    const out = ctx.createGain();
    out.gain.value = vol;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    out.connect(panner).connect(this.master);
    out.pitch = Phaser.Math.FloatBetween(1 - A.pitchVariance, 1 + A.pitchVariance);
    out.live = 0;
    out.release = () => {
      out.disconnect();
      panner.disconnect();
    };

    const handles = build(out).filter(Boolean);
    return { stop: () => handles.forEach((h) => h.stop()) };
  }

  tone(out, { type = 'sine', freq, to = freq, dur, vol, attack = 0.003, delay = 0 }) {
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq * out.pitch, t);
    osc.frequency.exponentialRampToValueAtTime(to * out.pitch, t + dur);
    const g = this.envelope(t, dur, vol, attack);
    osc.connect(g).connect(out);
    osc.start(t);
    return this.track(out, osc, g, t + dur);
  }

  noise(out, { filter = 'bandpass', freq, to = freq, q = 1, dur, vol, attack = 0.003, delay = 0 }) {
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq * out.pitch, t);
    f.frequency.exponentialRampToValueAtTime(to * out.pitch, t + dur);
    const g = this.envelope(t, dur, vol, attack);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    return this.track(out, src, g, t + dur);
  }

  envelope(t, dur, vol, attack) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(attack, dur * 0.9));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  // Stops the source at `end`, disconnects the voice once all its sources finish, returns a stop handle.
  track(out, src, g, end) {
    out.live++;
    src.stop(end + 0.05);
    src.onended = () => {
      g.disconnect();
      if (--out.live === 0) out.release();
    };
    return {
      stop: () => {
        const now = this.ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setTargetAtTime(0.0001, now, 0.01);
        try {
          src.stop(now + 0.06);
        } catch {
          // already stopped
        }
      },
    };
  }
}

export const sfx = new Sfx();
