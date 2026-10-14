import Phaser from 'phaser';
import { TUNING } from '../tuning.js';

const T = TUNING.player;

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

    this.aimMarker = scene.add.image(x, y, 'aim').setDepth(11);
  }

  // dir is a normalized input vector (or zero). Velocity eases toward dir * maxSpeed.
  move(dir, dt, now) {
    const vel = this.body.velocity;
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

  hurt(damage, dir, now) {
    this.hp -= damage;
    this.invulnUntil = now + T.invulnMs;
    this.stunUntil = now + T.hurtStunMs;
    this.body.velocity.copy(dir).scale(T.hurtKnockback);
  }

  isInvulnerable(now) {
    return now < this.invulnUntil;
  }

  syncVisuals(now) {
    const d = T.radius + 9;
    this.aimMarker.setPosition(this.x + Math.cos(this.aimAngle) * d, this.y + Math.sin(this.aimAngle) * d);
    this.aimMarker.setRotation(this.aimAngle);
    const blink = this.isInvulnerable(now) && Math.floor(now / 60) % 2 === 0;
    this.setAlpha(blink ? 0.35 : 1);
  }
}
