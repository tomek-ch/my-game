import Phaser from 'phaser';
import { TUNING } from '../tuning.js';

const T = TUNING.player;
const D = TUNING.dash;

export class Player extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'player');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.body.setCircle(T.radius);
    this.setCollideWorldBounds(true);
    this.setDepth(10);

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

    this.aimMarker = scene.add.image(x, y, 'aim').setDepth(11);
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

  syncVisuals(now) {
    const d = T.radius + 9;
    this.aimMarker.setPosition(this.x + Math.cos(this.aimAngle) * d, this.y + Math.sin(this.aimAngle) * d);
    this.aimMarker.setRotation(this.aimAngle);
    const blink = now < this.invulnUntil && Math.floor(now / 60) % 2 === 0;
    this.setAlpha(blink ? 0.35 : 1);
  }
}
