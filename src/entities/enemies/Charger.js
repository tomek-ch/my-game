import Phaser from 'phaser';
import { Enemy } from './Enemy.js';
import { sfx } from '../../audio/sfx.js';

// chase -> telegraph (stops, shows its path) -> charge -> recover (dazed) -> chase
export class Charger extends Enemy {
  constructor(scene, x, y) {
    super(scene, x, y, 'charger');
    this.cooldownLeft = 0;
    this.aim = 0;
    this.travelled = 0;
  }

  think(player, dt) {
    const c = this.cfg;
    this.cooldownLeft -= dt;

    if (this.mode === 'chase') {
      super.think(player, dt);
      const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
      if (dist <= c.triggerRange && this.cooldownLeft <= 0) {
        this.aim = this.angleTo(player);
        this.enter('telegraph');
        this.windupSound = sfx.chargerTelegraph(this.x, this.y, c.telegraphMs / 1000);
      }
    } else if (this.mode === 'telegraph') {
      this.brake(dt);
      const t = this.stateT * 1000;
      if (t < c.telegraphMs - c.aimLockMs) this.aim = this.angleTo(player);
      this.setRotation(this.aim);
      this.drawPath(t / c.telegraphMs);
      if (t >= c.telegraphMs) this.startCharge();
    } else if (this.mode === 'charge') {
      this.body.velocity.setToPolar(this.aim, c.chargeSpeed);
      this.travelled += c.chargeSpeed * dt;
      this.scene.fx.afterimage(this, c.color);
      if (this.travelled >= c.chargeDistance || !this.body.blocked.none) this.endCharge();
    } else if (this.mode === 'recover') {
      this.brake(dt);
      if (this.stateT * 1000 >= c.recoverMs) {
        this.setAlpha(1);
        this.cooldownLeft = c.cooldownMs / 1000;
        this.enter('chase');
      }
    }
  }

  // Path line that thickens as the charge gets close; the body blinks white near the end.
  drawPath(progress) {
    const g = this.telegraph();
    const len = this.cfg.chargeDistance;
    g.lineStyle(2 + progress * 6, this.cfg.color, 0.15 + progress * 0.45);
    g.lineBetween(this.x, this.y, this.x + Math.cos(this.aim) * len, this.y + Math.sin(this.aim) * len);
    const blink = progress > 0.5 && Math.floor(this.stateT * 1000 / 70) % 2 === 0;
    if (blink) this.setTintFill(0xffffff);
    else this.clearTint();
  }

  startCharge() {
    this.stopWindupSound();
    sfx.chargerLaunch(this.x, this.y);
    this.clearTelegraph();
    this.clearTint();
    this.travelled = 0;
    this.scene.fx.hitSparks(this.x, this.y);
    this.enter('charge');
  }

  endCharge() {
    this.setAlpha(0.6);
    this.enter('recover');
  }

  interrupt() {
    super.interrupt();
    this.cooldownLeft = this.cfg.cooldownMs / 2000;
  }

  contact(now) {
    const base = super.contact(now);
    if (!base || this.mode !== 'charge') return base;
    return { damage: this.cfg.chargeDamage, knockback: this.cfg.chargeKnockback };
  }
}
