import Phaser from 'phaser';
import { TUNING } from '../tuning.js';
import { sfx } from '../audio/sfx.js';
import { HeroClass } from './HeroClass.js';
import { isFrozen } from '../entities/hitstop.js';
import { pixelSector, pixelSpearhead, pixelSpike, spearheadBackEdge } from '../pixelShapes.js';
import { ART_SCALE } from '../art.js';

export const MOMENTUM_TINT = 0xff8a3d;
export const RAGE_TINT = 0xff3b3b;
const EDGE_TINT = 0xffe2b8; // the strike's leading edge
const STRIKE_SWING_DEG = 110; // the axe starts this far to one side of the strike and ends at rest on the other

// No plain dash: the attack is a dash strike toward the aim that cuts through everything in its path,
// and right click leaps to the aim and slams down, which also gets you out of trouble after a miss.
// A strike that hits can be chained straight into the next; a miss, or bouncing off a brute, puts it
// on cooldown. Hits fill the
// momentum bar, which drains when you stop hitting. Past half, strikes hit harder and go through
// brutes; half the bar buys a whirlwind that hits everything around you, so from a full bar you can
// spin twice, or once and stay raging.
export class Berserker extends HeroClass {
  static id = 'berserker';
  static title = 'Berserker';
  static heroes = ['lizard_m', 'lizard_f'];
  static weapon = { frame: 'weapon_waraxe', originY: 0.85 };
  static hud = 'meter';
  static controls = [
    { action: 'Move', kbm: 'WSAD', pad: 'Left stick' },
    { action: 'Aim', kbm: 'Mouse', pad: 'Right stick' },
    { action: 'Dash strike - hits chain it', kbm: 'Left click', pad: 'RB' },
    { action: 'Leap slam', kbm: 'Right click', pad: 'LB' },
    { action: 'Whirlwind - half bar', kbm: 'Space', pad: 'RT / A' },
  ];

  constructor(scene, player) {
    super(scene, player);
    this.meter = 0;
    this.lastGainAt = -Infinity;
    this.holdUntil = 0;       // no draining before this, see TUNING.classes.berserker.spin.holdMs
    this.strike = null;       // the strike in progress, see tryStrike()
    this.leap = null;         // the leap in progress, see tryLeap()
    this.nextLeapAt = 0;
    this.leapShown = true;    // whether the leap-back ring has played since the last landing
    this.marker = scene.add.graphics().setDepth(4); // the landing spot, with the telegraphs
    this.side = 1;            // strikes alternate which way the axe swings
    this.cooldownShown = true; // whether the dash-back ring has played since the last miss
    this.head = scene.add.graphics();
    this.lines = scene.add.graphics(); // the speed lines, drawn behind the hero
    this.headAngle = 0;
    this.headRaging = false;  // whether the last strike was enraged, for its look while it fades
    this.headFadeFrom = -Infinity; // when the last strike ended, for the arrowhead's fade
    player.on('destroy', () => {
      this.head.destroy();
      this.lines.destroy();
      this.marker.destroy();
    });
  }

  get hudValue() {
    return this.meter;
  }

  get raging() {
    return this.meter >= this.cfg.meter.rageAt;
  }

  update(now, dt) {
    const p = this.player;
    // Physics moved the player since last frame: hit whatever that stretch of the strike went through.
    if (this.strike) {
      this.sweepStrike(now);
      if (!p.isDashing) this.endStrike(now);
    }
    if (this.leap) this.updateLeap(now, dt);
    else {
      this.tryLeap(now);
      this.tryStrike(now);
      this.trySpin(now);
    }
    if (isFrozen(p, now)) return; // a hit just landed: the rest of the strike waits out the hitstop
    if (!this.leap) p.move(p.controls.move, dt, now);
    this.drain(now, dt);

    if (p.isDashing && now >= this.nextGhostAt) {
      this.scene.fx.afterimage(p, (this.strike?.raging ?? this.headRaging) ? RAGE_TINT : MOMENTUM_TINT);
      this.nextGhostAt = now + this.cfg.strike.ghostIntervalMs;
    }
    // Only a miss's cooldown is worth announcing; chained strikes are ready again at once.
    if (!this.cooldownShown && !this.strike && now >= p.nextDashAt) {
      this.cooldownShown = true;
      this.scene.fx.readyRing(p, TUNING.player.radius, MOMENTUM_TINT);
      sfx.dashReady();
    }
    if (!this.leapShown && !this.leap && now >= this.nextLeapAt) {
      this.leapShown = true;
      this.scene.fx.readyRing(p, TUNING.player.radius * 1.4);
      sfx.dashReady();
    }
  }

  // Melee strikes toward the aim (bent toward an enemy roughly in front).
  tryStrike(now) {
    const p = this.player;
    const c = p.controls;
    const S = this.cfg.strike;
    if (now - c.attackQueuedAt > S.bufferMs || !p.canDash(now)) return;
    c.attackQueuedAt = -Infinity;

    const target = this.scene.findTarget(p, S.distance + S.assistRange, S.assistDeg);
    const angle = target ? target.angle : p.aimAngle;
    p.dash(angle, now, { ...S, cooldownMs: 0 });
    p.nextDashAt = Infinity; // set when the strike ends, by whether it hit
    this.strike = {
      angle,
      // Decided at launch and kept for the whole strike, even if its hits push the bar past rageAt.
      raging: this.raging,
      lastX: p.x,
      lastY: p.y,
      hit: new Set(),
      struckAny: false,
      stopped: false,
    };

    this.side = -this.side;
    const swing = Phaser.Math.DegToRad(STRIKE_SWING_DEG);
    const rest = Phaser.Math.DegToRad(65);
    p.swingWeapon(angle - this.side * swing, angle + this.side * rest, S.durationMs, this.side, now);
    this.scene.fx.dashStart(p, angle);
    sfx.dash();
  }

  // Hits every enemy the player's body passed (with hitPad to spare) between last frame and this one,
  // nearest first. A heavy enemy stops the strike unless it's enraged, and nothing past it is hit.
  sweepStrike(now) {
    const p = this.player;
    const scene = this.scene;
    const S = this.cfg.strike;
    const strike = this.strike;
    const ax = strike.lastX;
    const ay = strike.lastY;
    const seg = new Phaser.Math.Vector2(p.x - ax, p.y - ay);
    const len = seg.length();
    const fwd = len > 0.01 ? seg.clone().scale(1 / len) : new Phaser.Math.Vector2().setToPolar(strike.angle);
    strike.lastX = p.x;
    strike.lastY = p.y;

    // Distance along the segment and away from it, for a point (x, y).
    const project = (x, y) => {
      const along = Phaser.Math.Clamp((x - ax) * fwd.x + (y - ay) * fwd.y, 0, len);
      const cx = ax + fwd.x * along;
      const cy = ay + fwd.y * along;
      return { along, cx, cy, away: Math.hypot(x - cx, y - cy) };
    };
    const reach = (radius) => TUNING.player.radius + radius + S.hitPad;

    scene.cutBullets((x, y, radius) => project(x, y).away <= reach(radius));

    const victims = [];
    for (const enemy of scene.enemies.getChildren()) {
      if (enemy.dying || enemy.airborne || strike.hit.has(enemy)) continue;
      const pr = project(enemy.x, enemy.y);
      if (pr.away <= reach(enemy.radius)) victims.push({ enemy, ...pr });
    }
    if (victims.length === 0) return;
    victims.sort((a, b) => a.along - b.along);

    const { raging } = strike;
    let hits = 0;
    let kills = 0;
    let stopped = false;
    const struck = [];
    for (const { enemy, cx, cy } of victims) {
      strike.hit.add(enemy);
      const stopper = !raging && enemy.cfg.mass >= S.stopMass;
      // Flung out of the way: sideways off the path and a little forward.
      const dir = new Phaser.Math.Vector2(enemy.x - cx, enemy.y - cy);
      if (dir.lengthSq() < 0.01) dir.set(-fwd.y, fwd.x);
      dir.normalize().add(fwd.clone().scale(stopper ? 1 : 0.6)).normalize();
      const hit = { damage: raging ? S.rageDamage : S.damage, dir, knockback: S.knockback, heavy: raging };
      hits++;
      if (scene.strikeEnemy(enemy, hit, now, raging ? 0.45 : 0.3)) kills++;
      else struck.push(enemy);
      if (stopper) {
        stopped = true;
        break;
      }
    }

    const firstHit = !strike.struckAny;
    strike.struckAny = true;
    this.gain(hits * this.cfg.meter.perHit + kills * this.cfg.meter.perKill, now);
    if (hits > kills) sfx.hit(raging);
    const freeze = (firstHit ? S.hitstopMs : S.chainHitstopMs) + (kills > 0 ? S.killHitstopBonusMs : 0);
    scene.hitstop(freeze, p, ...struck);
    scene.fx.shake(S.shake);

    if (stopped) {
      // Bounced off: back the way you came, briefly out of control, and the chain is broken.
      strike.stopped = true;
      p.stopDash();
      p.body.velocity.copy(fwd).scale(-S.bounce);
      p.stunUntil = now + TUNING.player.hurtStunMs;
    }
  }

  endStrike(now) {
    const p = this.player;
    const S = this.cfg.strike;
    const strike = this.strike;
    this.strike = null;
    this.headFadeFrom = now;
    const chained = strike.struckAny && !strike.stopped;
    let cooldown = S.chainCooldownMs;
    if (strike.stopped) cooldown = S.stoppedCooldownMs;
    else if (!strike.struckAny) cooldown = S.missCooldownMs;
    p.nextDashAt = now + cooldown;
    this.cooldownShown = chained;
  }

  // A spearhead out in front during a strike, with speed lines streaming back from it behind the hero;
  // it all fades once the strike ends. Brightest along the leading edge and toward the tip.
  syncVisuals(now) {
    this.drawLandingSpot();
    const S = this.cfg.strike;
    const H = S.head;
    const g = this.head.clear();
    const lines = this.lines.clear();
    if (this.strike) {
      this.headAngle = this.strike.angle;
      this.headRaging = this.strike.raging;
    }
    const alpha = this.strike ? 1 : 1 - (now - this.headFadeFrom) / H.fadeMs;
    if (alpha <= 0) return;
    const p = this.player;
    const angle = this.headAngle;
    const color = this.headRaging ? RAGE_TINT : MOMENTUM_TINT;
    g.setDepth(p.depth + 0.0002);
    lines.setDepth(p.depth - 0.0002);

    const L = S.speedLines;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const flicker = Math.floor(now / L.flickerMs);
    const spread = H.halfWidth - L.halfWidth; // the outer lines' edges line up with the shoulders
    for (let i = 0; i < L.count; i++) {
      const side = (i / (L.count - 1)) * 2 - 1; // -1 to 1 across the head
      const off = side * spread;
      // Each line starts a little inside the head's back edge, so it grows out of it.
      const start = H.back + spearheadBackEdge(H, Math.abs(off)) + 3;
      const x = p.x + ux * start - uy * off;
      const y = p.y + uy * start + ux * off;
      const wake = L.innerLength + (1 - L.innerLength) * Math.abs(side);
      const len = L.length * wake * (1 - L.jitter * noise(i, flicker));
      const fill = i % 2 ? color : EDGE_TINT;
      lines.fillStyle(fill, 0.95 * alpha);
      pixelSpike(lines, x, y, angle + Math.PI, len, L.halfWidth, (f) => f < 0.6);
      lines.fillStyle(fill, 0.6 * alpha);
      pixelSpike(lines, x, y, angle + Math.PI, len, L.halfWidth, (f) => f >= 0.6);
    }

    const draw = (fill, a, pick) => {
      g.fillStyle(fill, a * alpha);
      pixelSpearhead(g, p.x, p.y, angle, H, pick);
    };
    draw(color, 0.8, (f, rim) => !rim && f < 0.5);
    draw(color, 0.95, (f, rim) => !rim && f >= 0.5);
    draw(EDGE_TINT, 1, (f, rim) => rim);
  }

  // Fire (right click) leaps toward the aim: to the cursor, or along the stick, at most maxDistance away.
  // Waits for a strike in progress to finish.
  tryLeap(now) {
    const p = this.player;
    const c = p.controls;
    const J = this.cfg.leap;
    if (now - c.shootQueuedAt > J.bufferMs || now < this.nextLeapAt || p.isDashing || now < p.stunUntil) return;
    c.shootQueuedAt = -Infinity;

    const aim = c.aimPoint ?? { x: p.x + Math.cos(p.aimAngle) * J.maxDistance, y: p.y + Math.sin(p.aimAngle) * J.maxDistance };
    const to = new Phaser.Math.Vector2(aim.x - p.x, aim.y - p.y).limit(J.maxDistance).add(p);
    const { width: W, height: H } = TUNING.world;
    const edge = TUNING.player.radius;
    to.set(Phaser.Math.Clamp(to.x, edge, W - edge), Phaser.Math.Clamp(to.y, edge, H - edge));
    const reach = Phaser.Math.Distance.Between(p.x, p.y, to.x, to.y) / J.maxDistance;
    const airMs = J.minAirMs + (J.maxAirMs - J.minAirMs) * reach;

    p.stepLeft = 0;
    p.shield(now + airMs + J.landingGraceMs);
    this.leap = { to, secs: airMs / 1000, t: 0, height: J.height * Math.max(reach, 0.4), raging: this.raging };
    this.scene.fx.hitSparks(p.x, p.y + TUNING.player.radius);
    sfx.bruteJump(p.x, p.y);
  }

  // Fly toward the landing spot on an arc, re-aiming each frame so nothing knocks it off course.
  updateLeap(now, dt) {
    const p = this.player;
    const leap = this.leap;
    leap.t += dt;
    const t = Math.min(leap.t / leap.secs, 1);
    p.setLift(leap.height * 4 * t * (1 - t));
    const left = Math.max(leap.secs - leap.t, dt);
    p.body.velocity.set((leap.to.x - p.x) / left, (leap.to.y - p.y) / left);
    if (t >= 1) this.land(now);
  }

  // Slam: hit everything around the landing spot. Hitting anything readies the next strike.
  land(now) {
    const p = this.player;
    const scene = this.scene;
    const J = this.cfg.leap;
    const { raging } = this.leap;
    this.leap = null;
    this.marker.clear();
    p.setLift(0);
    p.body.velocity.set(0, 0);
    this.nextLeapAt = now + J.cooldownMs;
    this.leapShown = false;

    const radius = raging ? J.rageRadius : J.radius;
    const inSlam = (x, y, r) => Phaser.Math.Distance.Between(p.x, p.y, x, y) <= radius + r;
    scene.cutBullets(inSlam);
    let hits = 0;
    let kills = 0;
    const struck = [];
    for (const enemy of [...scene.enemies.getChildren()]) {
      if (enemy.dying || enemy.airborne || !inSlam(enemy.x, enemy.y, enemy.radius)) continue;
      const dir = new Phaser.Math.Vector2(enemy.x - p.x, enemy.y - p.y);
      if (dir.lengthSq() < 0.01) dir.setToPolar(p.aimAngle);
      dir.normalize();
      const hit = { damage: raging ? J.rageDamage : J.damage, dir, knockback: J.knockback, stunMs: J.stunMs, heavy: raging };
      hits++;
      if (scene.strikeEnemy(enemy, hit, now, 0.4)) kills++;
      else struck.push(enemy);
    }
    this.gain(hits * this.cfg.meter.perHit + kills * this.cfg.meter.perKill, now);

    sfx.bruteSlam(p.x, p.y);
    scene.fx.slam(p.x, p.y, radius, raging ? RAGE_TINT : MOMENTUM_TINT);
    scene.fx.squash(p, 0.35, 160);
    scene.fx.shake(J.shake);
    if (hits > kills) sfx.hit(raging);
    if (hits > 0) {
      scene.hitstop(J.hitstopMs, p, ...struck);
      // Back into the chain straight away.
      p.nextDashAt = Math.min(p.nextDashAt, now);
      this.cooldownShown = true;
    }
  }

  // Dash (Space) with half a bar or more: hit everything around you. Waits for a strike in progress to finish.
  trySpin(now) {
    const p = this.player;
    const scene = this.scene;
    const W = this.cfg.spin;
    const c = p.controls;
    if (p.isDashing || now - c.dashQueuedAt > W.bufferMs) return;
    c.dashQueuedAt = -Infinity;
    if (this.meter < W.cost) {
      sfx.shotEmpty();
      scene.hud.shakeResource(this.playerIndex);
      return;
    }
    // Spend one half; whatever's left is held there for a moment.
    this.meter -= W.cost;
    this.holdUntil = now + W.holdMs;

    const inSpin = (x, y, radius) => Phaser.Math.Distance.Between(p.x, p.y, x, y) <= W.radius + radius;
    scene.cutBullets(inSpin);
    let hits = 0;
    let kills = 0;
    const struck = [];
    for (const enemy of [...scene.enemies.getChildren()]) {
      if (enemy.dying || enemy.airborne || !inSpin(enemy.x, enemy.y, enemy.radius)) continue;
      const dir = new Phaser.Math.Vector2(enemy.x - p.x, enemy.y - p.y);
      if (dir.lengthSq() < 0.01) dir.setToPolar(p.aimAngle);
      dir.normalize();
      const hit = { damage: W.damage, dir, knockback: W.knockback, stunMs: W.stunMs, heavy: true };
      hits++;
      if (scene.strikeEnemy(enemy, hit, now, 0.5)) kills++;
      else struck.push(enemy);
    }
    this.gain(kills * W.refundPerKill, now);

    this.side = -this.side;
    const from = p.aimAngle;
    p.swingWeapon(from, from + this.side * Math.PI * 2, W.swingMs, this.side, now);
    p.shield(now + W.invulnMs);
    scene.fx.slash(p, from, { range: W.radius, arcDeg: 360, sweep: this.side, finisher: true, color: RAGE_TINT });
    scene.fx.slam(p.x, p.y, W.radius, MOMENTUM_TINT);
    scene.fx.shake(W.shake);
    sfx.whirl();
    if (hits > kills) sfx.hit(true);
    if (hits > 0) scene.hitstop(W.hitstopMs, p, ...struck);

    // Strike straight out of the spin.
    p.nextDashAt = Math.min(p.nextDashAt, now);
    this.cooldownShown = true;
  }

  // A ring on the floor where the leap will land, the size of the slam.
  drawLandingSpot() {
    const g = this.marker.clear();
    const leap = this.leap;
    if (!leap) return;
    const J = this.cfg.leap;
    const radius = leap.raging ? J.rageRadius : J.radius;
    const t = Math.min(leap.t / leap.secs, 1);
    g.fillStyle(leap.raging ? RAGE_TINT : MOMENTUM_TINT, 0.15 + 0.35 * t);
    pixelSector(g, leap.to.x, leap.to.y, radius - 2 * ART_SCALE, radius);
  }

  gain(amount, now) {
    if (amount <= 0) return;
    const M = this.cfg.meter;
    const before = this.meter;
    this.meter = Math.min(this.meter + amount, M.max);
    this.lastGainAt = now;
    const p = this.player;
    // A ring and a chime for each whirlwind that becomes affordable.
    const cost = this.cfg.spin.cost;
    if (Math.floor(this.meter / cost) > Math.floor(before / cost)) {
      this.scene.fx.readyRing(p, TUNING.player.radius, RAGE_TINT);
      sfx.shotReady();
    } else if (this.meter >= M.rageAt && before < M.rageAt) {
      this.scene.fx.readyRing(p, TUNING.player.radius, MOMENTUM_TINT);
    }
  }

  // The bar holds during a strike, for a moment after the last gain, and after a whirlwind; then drains.
  drain(now, dt) {
    const M = this.cfg.meter;
    if (this.strike || now < this.holdUntil || now - this.lastGainAt < M.graceMs) return;
    this.meter = Math.max(0, this.meter - M.drainPerSec * dt);
  }
}

// A repeatable 0..1 value for speed line `i` at flicker step `step`.
function noise(i, step) {
  const x = Math.sin(i * 127.1 + step * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
