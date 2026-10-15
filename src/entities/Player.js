import Phaser from 'phaser';
import { TUNING } from '../tuning.js';
import { ySortDepth } from './depth.js';
import { ART_SCALE } from '../art.js';

const T = TUNING.player;
const D = TUNING.dash;

// The knight frame is 16x28 art pixels. The hit circle covers its lower body, and the origin sits at
// the circle's center so x/y mean the same thing they did for the old round placeholder.
const BODY_CENTER = { x: 8, y: 21 };
const HAND = { x: 3, y: -2 };   // art pixels from BODY_CENTER, facing right
const RUN_MIN_SPEED = 20;       // px/s; slower than this shows the idle loop

// The sword rests this far to one side of the aim and sweeps to the other side on each swing.
const SWORD_REST = Phaser.Math.DegToRad(65);
const SWORD_SWING_MS = { normal: 70, finisher: 95 };
const SWORD_SETTLE = 18;        // how fast it eases back to rest (per second, exponential)

export class Player extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'dungeon', 'knight_m_idle_anim_f0');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.baseScale = ART_SCALE;
    const r = T.radius / ART_SCALE;
    this.setScale(ART_SCALE).setOrigin(BODY_CENTER.x / this.width, BODY_CENTER.y / this.height);
    this.body.setCircle(r, BODY_CENTER.x - r, BODY_CENTER.y - r);
    this.play('knight_idle');
    this.setCollideWorldBounds(true);
    this.setDepth(ySortDepth(y));

    this.hp = T.maxHp;
    this.aimAngle = 0;
    this.invulnUntil = 0;
    this.stunUntil = 0;
    this.nextAttackAt = 0;
    this.nextShotAt = 0;
    this.comboIndex = 0;
    this.comboExpiresAt = 0;
    this.stepLeft = 0; // seconds of attack step remaining, only counts down while unfrozen
    this.stepVel = new Phaser.Math.Vector2();
    this.dashLeft = 0; // seconds, like stepLeft
    this.dashVel = new Phaser.Math.Vector2();
    this.nextDashAt = 0;
    this.dashInvulnUntil = 0;

    this.sword = scene.add.image(x, y, 'dungeon', 'weapon_knight_sword').setScale(ART_SCALE).setOrigin(0.5, 0.8);
    this.swordSide = -1;    // which side of the aim it rests on: -1 or 1
    this.swordAngle = -SWORD_REST;
    this.swordSwing = null; // { from, to, startedAt, ms } while a swing is playing
    this.lastSyncAt = scene.time.now;
  }

  // dir is a normalized input vector (or zero). Velocity eases toward dir * maxSpeed.
  move(dir, dt, now) {
    const vel = this.body.velocity;
    if (this.dashLeft > 0) {
      this.dashLeft -= dt;
      if (this.dashLeft > 0) vel.copy(this.dashVel);
      else vel.copy(this.dashVel).setLength(D.exitSpeed);
      return;
    }
    if (this.stepLeft > 0) {
      this.stepLeft -= dt;
      if (this.stepLeft > 0) vel.copy(this.stepVel);
      else vel.set(0, 0); // end the step dead, so it doesn't turn into a slide
      return;
    }
    if (now < this.stunUntil) {
      vel.scale(Math.exp(-T.stunFriction * dt));
      return;
    }
    const target = new Phaser.Math.Vector2(dir.x, dir.y).scale(T.maxSpeed);
    const hasInput = dir.lengthSq() > 0;
    let rate = hasInput ? T.accel : T.decel;
    if (hasInput && vel.dot(target) < 0) rate = T.turnAccel;

    const diff = target.subtract(vel);
    const step = rate * dt;
    if (diff.length() <= step) vel.add(diff);
    else vel.add(diff.setLength(step));
  }

  aimAt(worldX, worldY) {
    this.aimAngle = Math.atan2(worldY - this.y, worldX - this.x);
  }

  // Move `distance` px along `angle` over `ms`, ignoring input.
  step(angle, distance, ms) {
    this.stepLeft = ms / 1000;
    this.stepVel.setToPolar(angle, distance / this.stepLeft);
  }

  get isDashing() {
    return this.dashLeft > 0;
  }

  canDash(now) {
    return !this.isDashing && now >= this.nextDashAt && now >= this.stunUntil;
  }

  dash(angle, now) {
    this.stepLeft = 0;
    this.dashLeft = D.durationMs / 1000;
    this.dashVel.setToPolar(angle, D.distance / this.dashLeft);
    this.nextDashAt = now + D.durationMs + D.cooldownMs;
    this.dashInvulnUntil = now + D.durationMs + D.invulnGraceMs;
  }

  hurt(damage, dir, now, knockback = T.hurtKnockback) {
    this.stepLeft = 0;
    this.dashLeft = 0;
    this.hp -= damage;
    this.invulnUntil = now + T.invulnMs;
    this.stunUntil = now + T.hurtStunMs;
    this.body.velocity.copy(dir).scale(knockback);
  }

  isInvulnerable(now) {
    return now < this.invulnUntil || now < this.dashInvulnUntil;
  }

  // Sweep the sword across the swing's arc, the same way the slash effect is drawn.
  swingSword(angle, swing, now) {
    const half = Phaser.Math.DegToRad(swing.arcDeg) / 2;
    this.swordSwing = {
      from: angle - half * swing.sweep,
      to: angle + half * swing.sweep,
      startedAt: now,
      ms: swing.finisher ? SWORD_SWING_MS.finisher : SWORD_SWING_MS.normal,
    };
    this.swordSide = swing.sweep;
  }

  syncVisuals(now) {
    const dt = Math.min(now - this.lastSyncAt, 50) / 1000;
    this.lastSyncAt = now;

    const blink = now < this.invulnUntil && Math.floor(now / 60) % 2 === 0;
    this.setAlpha(blink ? 0.35 : 1);
    this.setFlipX(Math.cos(this.aimAngle) < 0);
    this.setDepth(ySortDepth(this.y));
    this.syncAnimation(now);
    this.syncSword(now, dt);
    this.sword.setAlpha(this.alpha);
  }

  syncAnimation(now) {
    if (now < this.stunUntil) {
      this.anims.stop();
      this.setFrame('knight_m_hit_anim_f0');
      return;
    }
    const speed = this.body.velocity.length();
    if (speed < RUN_MIN_SPEED) {
      this.play('knight_idle', true);
      this.anims.timeScale = 1;
    } else {
      this.play('knight_run', true);
      this.anims.timeScale = Phaser.Math.Clamp(speed / T.maxSpeed, 0.6, 1.6);
    }
  }

  syncSword(now, dt) {
    const facing = this.flipX ? -1 : 1;
    this.sword.setPosition(
      this.x + HAND.x * facing * ART_SCALE,
      this.y + HAND.y * ART_SCALE,
    );

    const swing = this.swordSwing;
    if (swing) {
      const t = Math.min((now - swing.startedAt) / swing.ms, 1);
      this.swordAngle = swing.from + (swing.to - swing.from) * Phaser.Math.Easing.Cubic.Out(t);
      if (t >= 1) this.swordSwing = null;
    } else {
      const rest = this.aimAngle + this.swordSide * SWORD_REST;
      const diff = Phaser.Math.Angle.Wrap(rest - this.swordAngle);
      this.swordAngle += diff * Math.min(1, SWORD_SETTLE * dt);
    }

    // The art points up, so add a quarter turn. Pointing away from the camera, it goes behind the knight.
    this.sword.setRotation(this.swordAngle + Math.PI / 2);
    this.sword.setDepth(this.depth + (Math.sin(this.swordAngle) < -0.2 ? -0.0001 : 0.0001));
  }

  // Grey out and freeze on death.
  showDead() {
    this.anims.stop();
    this.setFrame('knight_m_hit_anim_f0');
    this.setAlpha(1).setTint(0x555566);
    this.sword.setAlpha(1).setTint(0x555566);
  }
}
