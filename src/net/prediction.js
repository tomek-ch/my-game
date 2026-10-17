import Phaser from 'phaser';
import { TUNING } from '../tuning.js';
import { steerVelocity } from '../entities/Player.js';
import { PREDICTED_ABILITIES } from './abilities.js';

const HISTORY_MS = 2000;  // how far back predicted positions are kept, more than any round trip
const CORRECT_RATE = 6;   // per second: how fast a small disagreement with the host is eased away
const SNAP_ERROR = 100;   // px: a disagreement this big (a dash, a blink, a knockback) is jumped, not eased
// px: a disagreement this small is left alone. Our inputs reach the host bunched up by the network's
// unevenness, so even walking its timeline and ours are a frame or two apart, which is this much.
const DEAD_ZONE = 16;
// ms after a predicted dash ends before comparing with the host again: at dash speed, the frame or two
// between the host's timeline and ours (see DEAD_ZONE) is tens of px, until it's over.
const SETTLE_MS = 120;

// Online, the guest's own player as the guest sees it: moved straight away by the guest's input, the
// way Player walks, instead of a round trip later when the host's snapshot shows it. Its class's
// movement ability (src/net/abilities.js: the knight's dash, the berserker's strike, the mage's blink)
// starts on the press too, when it's ready by what the host last said and what we've done since.
// Anything else the host does to the player (an attack's step, a leap, a knockback, a hit's hitstop)
// shows up as a disagreement with the host, which is corrected.
//
// To compare like with like, each input carries our clock and each snapshot says which input the host
// had caught up to, so it's checked against where we predicted the player at that moment.
export class Prediction {
  // classId: our player's class, for its predicted ability.
  constructor(classId) {
    this.ability = PREDICTED_ABILITIES[classId] ?? null;
    this.pos = new Phaser.Math.Vector2();
    this.vel = new Phaser.Math.Vector2();
    this.dashLeft = 0; // seconds of a predicted dash still to go
    this.dashVel = new Phaser.Math.Vector2();
    this.usedPressAt = -Infinity; // the press that started the last predicted use, not to use twice
    this.pressSeen = { at: -Infinity, now: -Infinity }; // the newest press, and when we first saw it
    this.usedAt = -Infinity;      // when that was
    this.readyAt = -Infinity;     // when it's ready again after that, by its fixed cooldown
    this.trustFrom = -Infinity;   // comparisons with the host for moments before this are skipped (see SETTLE_MS)
    this.host = null; // the host's word on the ability, on our clock: { readyAt, stunUntil, busy, asOf }
    this.error = new Phaser.Math.Vector2(); // host minus prediction, still to be eased away
    this.history = []; // [time, x, y], oldest first
    this.active = false;
  }

  start(x, y) {
    this.pos.set(x, y);
    this.vel.set(0, 0);
    this.dashLeft = 0;
    this.error.set(0, 0);
    this.history = [];
    this.active = true;
  }

  stop() {
    this.active = false;
  }

  // What the host said about the ability (GameScene.abilityState) in a snapshot that had caught up to
  // our input from `inputAt`.
  hearHost(state, inputAt) {
    if (!state || inputAt === null) return;
    const at = (ms) => (ms === null ? Infinity : inputAt + ms);
    this.host = { readyAt: at(state.readyIn), stunUntil: at(state.stunIn), busy: state.busy, asOf: inputAt };
  }

  // One frame: `controls` our input this frame, `now` performance.now(), `resource` the latest HUD
  // value of our class's resource (mana), for an ability's cost.
  step(controls, dt, now, resource) {
    this.tryAbility(controls, now, resource);
    if (this.dashLeft > 0) {
      // As Player.move: the dash's speed throughout, then out of it at its exit speed.
      this.dashLeft -= dt;
      if (this.dashLeft > 0) this.vel.copy(this.dashVel);
      else this.vel.copy(this.dashVel).setLength(this.ability.cfg.exitSpeed);
    } else if (now < (this.host?.stunUntil ?? 0)) {
      this.vel.scale(Math.exp(-TUNING.player.stunFriction * dt));
    } else {
      steerVelocity(this.vel, controls.move, dt);
    }
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

  // Starts the ability on a fresh press once it's ready. The press's buffer runs from when we first see
  // it, as the host's runs from when it arrives: a slow frame here mustn't let it lapse before the host
  // would have.
  tryAbility(c, now, resource) {
    const a = this.ability;
    if (!a) return;
    const pressAt = c[a.press];
    if (pressAt !== this.pressSeen.at) this.pressSeen = { at: pressAt, now };
    if (pressAt <= this.usedPressAt || now - this.pressSeen.now > a.cfg.bufferMs || !this.abilityReady(now, resource)) return;
    this.usedPressAt = pressAt;
    this.usedAt = now;
    this.readyAt = a.cooldown === null ? Infinity : now + a.cooldown;
    const aimAngle = c.aimAngle ?? 0;
    if (a.kind === 'dash') {
      const angle = a.angle === 'move' && c.move.lengthSq() > 0 ? c.move.angle() : aimAngle;
      this.trustFrom = now + a.cfg.durationMs + SETTLE_MS;
      this.dashLeft = a.cfg.durationMs / 1000;
      this.dashVel.setToPolar(angle, a.cfg.distance / this.dashLeft);
    } else {
      // As Mage.aimTarget: the cursor, at most range away, inside the world.
      const to = c.aimPoint
        ? new Phaser.Math.Vector2(c.aimPoint.x - this.pos.x, c.aimPoint.y - this.pos.y).limit(a.cfg.range)
        : new Phaser.Math.Vector2().setToPolar(aimAngle, a.cfg.range);
      const r = TUNING.player.radius;
      const { width: W, height: H } = TUNING.world;
      this.pos.set(Phaser.Math.Clamp(this.pos.x + to.x, r, W - r), Phaser.Math.Clamp(this.pos.y + to.y, r, H - r));
    }
  }

  // Before the host has seen our last use, its own cooldown says (unknown for a strike, so not until
  // the host says); after, the host's word as of then.
  abilityReady(now, resource) {
    if (this.dashLeft > 0) return false;
    const h = this.host;
    if (!h || this.usedAt > h.asOf) return now >= this.readyAt;
    if (h.busy || now < h.readyAt || now < h.stunUntil) return false;
    return this.ability.cost === undefined || resource >= this.ability.cost;
  }

  // The host had the player at (x, y) having had our input up to `then` (performance.now() time).
  // Not while the host says the ability is still going (a strike that hit something waits out the
  // hitstop and ends later than ours, at the same spot): call hearHost with the same snapshot first.
  reconcile(x, y, then) {
    if (then < this.trustFrom || this.host?.busy) return;
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
