import Phaser from 'phaser';
import { TUNING } from '../../tuning.js';
import { Enemy } from './Enemy.js';
import { sfx } from '../../audio/sfx.js';

const LUNGE_SECS = 0.1;

// chase -> windup (red area fills up) -> swing -> recover -> chase.
// Light hits only chip it; a heavy hit (combo finisher) staggers it and cancels the swing.
export class Brute extends Enemy {
  constructor(scene, x, y) {
    super(scene, x, y, 'brute');
    this.cooldownLeft = 0;
    this.aim = 0;
    this.bar = scene.add.graphics().setDepth(30);
    this.on('destroy', () => this.bar.destroy());
  }

  think(player, dt) {
    const a = this.cfg.attack;
    this.cooldownLeft -= dt;

    if (this.mode === 'chase') {
      super.think(player, dt);
      const gap = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y) - TUNING.player.radius;
      if (gap <= a.triggerRange && this.cooldownLeft <= 0) {
        this.aim = this.angleTo(player);
        this.enter('windup');
        this.windupSound = sfx.bruteWindup(this.x, this.y, a.windupMs / 1000);
      }
    } else if (this.mode === 'windup') {
      this.brake(dt);
      this.setRotation(this.aim);
      const progress = this.stateT * 1000 / a.windupMs;
      this.drawArea(Math.min(progress, 1));
      if (progress >= 1) this.swing(player);
    } else if (this.mode === 'recover') {
      if (this.stateT >= LUNGE_SECS) this.body.velocity.set(0, 0);
      if (this.stateT * 1000 >= a.recoveryMs) {
        this.cooldownLeft = a.cooldownMs / 1000;
        this.enter('chase');
      }
    }
  }

  // Faint outline of the whole danger zone, plus a fill that grows outward as the swing approaches.
  drawArea(progress) {
    const a = this.cfg.attack;
    const half = Phaser.Math.DegToRad(a.arcDeg) / 2;
    const g = this.telegraph();
    const fan = (radius) => {
      g.beginPath();
      g.moveTo(this.x, this.y);
      g.arc(this.x, this.y, radius, this.aim - half, this.aim + half, false);
      g.closePath();
    };
    g.fillStyle(0xff3040, 0.12);
    fan(a.reach);
    g.fillPath();
    g.lineStyle(2, 0xff3040, 0.5);
    fan(a.reach);
    g.strokePath();
    g.fillStyle(0xff3040, 0.15 + progress * 0.25);
    fan(a.reach * progress);
    g.fillPath();
  }

  swing(player) {
    const a = this.cfg.attack;
    const scene = this.scene;
    this.windupSound = null;
    this.clearTelegraph();
    sfx.bruteSwing(this.x, this.y);
    scene.fx.slash(this, this.aim, {
      range: a.reach, arcDeg: a.arcDeg, sweep: Math.random() < 0.5 ? 1 : -1, finisher: true, color: 0xff6b6b,
    });
    scene.fx.shake(a.shake);
    this.body.velocity.setToPolar(this.aim, a.lunge / LUNGE_SECS);

    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.hypot(dx, dy);
    const inReach = dist <= a.reach + TUNING.player.radius;
    const offAngle = Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - this.aim));
    const touching = dist <= this.radius + TUNING.player.radius;
    if (inReach && (touching || offAngle <= Phaser.Math.DegToRad(a.arcDeg) / 2)) {
      const dir = new Phaser.Math.Vector2(dx, dy).normalize();
      scene.damagePlayer(a.damage, dir, a.knockback);
    }
    this.enter('recover');
  }

  onHit(hit, now) {
    if (hit.heavy) {
      this.knock(hit.dir, hit.knockback * this.cfg.heavyKnockbackScale, now, this.cfg.staggerMs);
      sfx.bruteStagger(this.x, this.y);
    } else {
      this.body.velocity.add(hit.dir.clone().scale(hit.knockback * 0.1));
    }
  }

  interrupt() {
    super.interrupt();
    this.cooldownLeft = this.cfg.attack.cooldownMs / 2000;
  }

  syncVisuals() {
    const g = this.bar.clear();
    if (this.hp >= this.cfg.hp || this.dying) return;
    const w = 40;
    const x = this.x - w / 2;
    const y = this.y - this.radius - 14;
    g.fillStyle(0x000000, 0.6).fillRect(x - 1, y - 1, w + 2, 6);
    g.fillStyle(0xff4d6d).fillRect(x, y, w * Math.max(this.hp, 0) / this.cfg.hp, 4);
  }

  die() {
    this.bar.clear();
    super.die();
  }
}
