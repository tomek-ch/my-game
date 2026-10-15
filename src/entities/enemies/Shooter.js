import Phaser from 'phaser';
import { Enemy } from './Enemy.js';
import { sfx } from '../../audio/sfx.js';
import { pixelDisk } from '../../pixelShapes.js';

// Holds a preferred distance while strafing; periodically stops to aim and fire one bullet.
export class Shooter extends Enemy {
  constructor(scene, x, y) {
    super(scene, x, y, 'shooter');
    this.fireLeft = this.cfg.fireIntervalMs / 1000 * Phaser.Math.FloatBetween(0.5, 1);
    this.strafeSign = Math.random() < 0.5 ? -1 : 1;
    this.strafeFlipLeft = Phaser.Math.FloatBetween(1.5, 3);
  }

  think(player, dt) {
    const c = this.cfg;
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    this.facing = Math.atan2(dy, dx);

    if (this.mode === 'chase') {
      this.strafeFlipLeft -= dt;
      if (this.strafeFlipLeft <= 0) {
        this.strafeSign *= -1;
        this.strafeFlipLeft = Phaser.Math.FloatBetween(1.5, 3);
      }
      let radial = 0;
      if (dist > c.preferredRange + c.rangeSlack) radial = 1;
      else if (dist < c.preferredRange - c.rangeSlack) radial = -1;
      const nx = dx / dist;
      const ny = dy / dist;
      const desired = new Phaser.Math.Vector2(
        nx * radial * c.maxSpeed - ny * this.strafeSign * c.strafeSpeed,
        ny * radial * c.maxSpeed + nx * this.strafeSign * c.strafeSpeed,
      );
      this.steerToward(desired, dt);

      this.fireLeft -= dt;
      if (this.fireLeft <= 0 && dist <= c.fireRange) {
        this.enter('aim');
        this.windupSound = sfx.shooterCharge(this.x, this.y, c.telegraphMs / 1000);
      }
    } else if (this.mode === 'aim') {
      this.brake(dt);
      const progress = this.stateT * 1000 / c.telegraphMs;
      this.drawCharge(progress);
      if (progress >= 1) this.fire();
    }
  }

  // A growing orb at the barrel.
  drawCharge(progress) {
    const g = this.telegraph();
    const d = this.radius + 8;
    g.fillStyle(this.cfg.color, 0.4 + progress * 0.5);
    pixelDisk(g, this.x + Math.cos(this.facing) * d, this.y + Math.sin(this.facing) * d, 2 + progress * 5);
  }

  fire() {
    this.windupSound = null;
    this.clearTelegraph();
    const d = this.radius + 8;
    const x = this.x + Math.cos(this.facing) * d;
    const y = this.y + Math.sin(this.facing) * d;
    this.scene.spawnEnemyBullet(x, y, this.facing, this.cfg);
    sfx.shooterFire(x, y);
    this.body.velocity.setToPolar(this.facing, -60);
    this.fireLeft = this.cfg.fireIntervalMs / 1000 * Phaser.Math.FloatBetween(0.8, 1.2);
    this.enter('chase');
  }

  interrupt() {
    super.interrupt();
    this.fireLeft = Math.max(this.fireLeft, 0.5);
  }
}
