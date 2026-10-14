import Phaser from 'phaser';
import { TUNING } from '../tuning.js';

const E = TUNING.enemy;

export class Enemy extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'enemy');
    scene.add.existing(this);
    this.setDepth(5);
    this.hp = E.hp;
    this.stunUntil = 0;
    this.spawnGraceUntil = scene.time.now + E.spawnGraceMs;
    this.dying = false;
  }

  // Call after adding to a physics group: the group resets body settings when it adopts a child.
  setupBody() {
    this.body.setCircle(E.radius);
    this.setCollideWorldBounds(true);
    this.setScale(0);
    this.scene.tweens.add({ targets: this, scale: 1, duration: 220, ease: 'Back.easeOut' });
  }

  chase(target, dt, now) {
    const vel = this.body.velocity;
    if (now < this.stunUntil) {
      vel.scale(Math.exp(-E.knockbackFriction * dt));
      return;
    }
    const desired = new Phaser.Math.Vector2(target.x - this.x, target.y - this.y).setLength(E.maxSpeed);
    const diff = desired.subtract(vel);
    const step = E.accel * dt;
    if (diff.length() <= step) vel.add(diff);
    else vel.add(diff.setLength(step));
    this.setRotation(Math.atan2(vel.y, vel.x));
  }

  knock(dir, force, now, stunMs = E.stunMs) {
    this.body.velocity.copy(dir).scale(force);
    this.stunUntil = Math.max(this.stunUntil, now + stunMs);
  }

  // Enemies reeling from a hit can't deal contact damage.
  canHurt(now) {
    return !this.dying && now >= this.spawnGraceUntil && now >= this.stunUntil;
  }

  // Returns true when this hit kills it.
  takeHit(damage, dir, force, now, stunMs) {
    this.hp -= damage;
    this.knock(dir, force, now, stunMs);
    return this.hp <= 0;
  }

  die() {
    this.dying = true;
    this.body.enable = false;
    this.setTintFill(0xffffff);
    this.scene.tweens.add({
      targets: this,
      scale: 1.6,
      alpha: 0,
      duration: 140,
      ease: 'Quad.easeOut',
      onComplete: () => this.destroy(),
    });
  }
}
