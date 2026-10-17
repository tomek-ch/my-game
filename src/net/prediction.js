import Phaser from 'phaser';
import { TUNING } from '../tuning.js';
import { steerVelocity } from '../entities/Player.js';

const HISTORY_MS = 2000;  // how far back predicted positions are kept, more than any round trip
const CORRECT_RATE = 6;   // per second: how fast a small disagreement with the host is eased away
const SNAP_ERROR = 100;   // px: a disagreement this big (a dash, a blink, a knockback) is jumped, not eased
const DEAD_ZONE = 8;      // px: a disagreement this small is left alone (the host's frames and ours don't line up exactly)

// Online, the guest's own player as the guest sees it: moved straight away by the guest's input, the
// way Player walks, instead of a round trip later when the host's snapshot shows it. Only walking is
// predicted; anything else the host does to the player (a dash, an attack's step, a knockback, a stun)
// shows up as a disagreement with the host, which is corrected.
//
// To compare like with like, each input carries our clock and each snapshot says which input the host
// had caught up to, so it's checked against where we predicted the player at that moment.
export class Prediction {
  constructor() {
    this.pos = new Phaser.Math.Vector2();
    this.vel = new Phaser.Math.Vector2();
    this.error = new Phaser.Math.Vector2(); // host minus prediction, still to be eased away
    this.history = []; // [time, x, y], oldest first
    this.active = false;
  }

  start(x, y) {
    this.pos.set(x, y);
    this.vel.set(0, 0);
    this.error.set(0, 0);
    this.history = [];
    this.active = true;
  }

  stop() {
    this.active = false;
  }

  // One frame: `dir` is the input's move vector, `now` is performance.now().
  step(dir, dt, now) {
    steerVelocity(this.vel, dir, dt);
    const r = TUNING.player.radius;
    const { width: W, height: H } = TUNING.world;
    this.pos.x = Phaser.Math.Clamp(this.pos.x + this.vel.x * dt, r, W - r);
    this.pos.y = Phaser.Math.Clamp(this.pos.y + this.vel.y * dt, r, H - r);
    const k = Math.min(1, CORRECT_RATE * dt);
    this.shift(this.error.x * k, this.error.y * k);
    this.error.scale(1 - k);
    this.history.push([now, this.pos.x, this.pos.y]);
    while (this.history.length && this.history[0][0] < now - HISTORY_MS) this.history.shift();
  }

  // The host had the player at (x, y) having had our input up to `then` (performance.now() time).
  reconcile(x, y, then) {
    const past = this.at(then);
    if (!past) return;
    const ex = x - past[0];
    const ey = y - past[1];
    const size = Math.hypot(ex, ey);
    if (size < DEAD_ZONE) {
      this.error.set(0, 0);
    } else if (size > SNAP_ERROR) {
      this.shift(ex, ey);
      this.error.set(0, 0);
    } else {
      this.error.set(ex, ey); // a fresh measurement, so it replaces what was left of the last
    }
  }

  // Moves the prediction, and its history with it, so the next comparison counts what's corrected.
  shift(dx, dy) {
    this.pos.x += dx;
    this.pos.y += dy;
    for (const h of this.history) {
      h[1] += dx;
      h[2] += dy;
    }
  }

  // Where the prediction had the player at `time`, or null if that's outside the history.
  at(time) {
    const h = this.history;
    if (!h.length || time < h[0][0]) return null;
    for (let i = h.length - 1; i >= 0; i--) {
      if (h[i][0] > time) continue;
      const next = h[i + 1];
      if (!next) return [h[i][1], h[i][2]];
      const t = (time - h[i][0]) / (next[0] - h[i][0]);
      return [h[i][1] + (next[1] - h[i][1]) * t, h[i][2] + (next[2] - h[i][2]) * t];
    }
    return null;
  }
}
