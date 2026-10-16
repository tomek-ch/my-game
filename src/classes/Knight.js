import Phaser from 'phaser';
import { TUNING } from '../tuning.js';
import { ART_SCALE } from '../art.js';
import { sfx } from '../audio/sfx.js';
import { BOLT_TINT } from '../textures.js';
import { HeroClass } from './HeroClass.js';

const SWORD_SWING_MS = { normal: 70, finisher: 95 };

// A three-hit sword combo, a dash, and heavy piercing bolts that sword hits charge up.
export class Knight extends HeroClass {
  static id = 'knight';
  static title = 'Knight';
  static heroes = ['knight_m', 'knight_f'];
  static weapon = { frame: 'weapon_knight_sword', originY: 0.8 };
  static hud = 'charges';
  static controls = [
    { action: 'Move', kbm: 'WSAD', pad: 'Left stick' },
    { action: 'Aim', kbm: 'Mouse', pad: 'Right stick' },
    { action: 'Dash', kbm: 'Space', pad: 'RT / A' },
    { action: 'Melee', kbm: 'Left click', pad: 'RB' },
    { action: 'Shot - sword hits charge it', kbm: 'Right click', pad: 'LB' },
  ];

  constructor(scene, player) {
    super(scene, player);
    const R = this.cfg.ranged;
    this.pips = R.startCharges * R.pipsPerCharge; // shot charge, see TUNING.classes.knight.ranged
    this.nextAttackAt = 0;
    this.nextShotAt = 0;
    this.comboIndex = 0;
    this.comboExpiresAt = 0;
  }

  get hudValue() {
    return this.pips;
  }

  update(now, dt) {
    this.tryDash(now);
    this.player.move(this.player.controls.move, dt, now);
    this.tryAttack(now);
    this.tryShoot(now);
    this.dashFx(now, this.cfg.dash.ghostIntervalMs);
  }

  // Dash where you're moving, or where you're aiming when standing still.
  tryDash(now) {
    const p = this.player;
    const c = p.controls;
    const D = this.cfg.dash;
    if (now - c.dashQueuedAt > D.bufferMs || !p.canDash(now)) return;
    c.dashQueuedAt = -Infinity;
    const angle = c.move.lengthSq() > 0 ? c.move.angle() : p.aimAngle;
    p.dash(angle, now, D);
    this.scene.fx.dashStart(p, angle);
    sfx.dash();
    this.dashWasReady = false;
  }

  tryAttack(now) {
    const p = this.player;
    const scene = this.scene;
    const M = this.cfg.melee;
    // Clicks during a dash stay buffered and fire as it ends.
    if (p.isDashing) return;
    const c = p.controls;
    if (now - c.attackQueuedAt > M.bufferMs || now < this.nextAttackAt) return;
    c.attackQueuedAt = -Infinity;

    if (now > this.comboExpiresAt) this.comboIndex = 0;
    const swing = M.swings[this.comboIndex];
    const isFinisher = this.comboIndex === M.swings.length - 1;
    this.nextAttackAt = now + swing.recoveryMs + (isFinisher ? M.comboCooldownMs : 0);
    this.comboExpiresAt = now + swing.recoveryMs + M.comboWindowMs;
    this.comboIndex = isFinisher ? 0 : this.comboIndex + 1;

    // Aim assist: step toward the nearest enemy roughly in front, and bend the swing toward it.
    const target = scene.findTarget(p, swing.range + M.assistRange, M.assistDeg);
    let angle = p.aimAngle;
    let stepDist = swing.step;
    if (target) {
      angle = target.angle;
      const gap = TUNING.player.radius + target.enemy.radius + M.stepGap;
      stepDist = Phaser.Math.Clamp(target.dist - gap, 0, swing.maxStep);
    }
    p.step(angle, stepDist, M.stepMs);
    scene.fx.slash(p, angle, swing);
    const half = Phaser.Math.DegToRad(swing.arcDeg) / 2;
    p.swingWeapon(angle - half * swing.sweep, angle + half * swing.sweep,
      swing.finisher ? SWORD_SWING_MS.finisher : SWORD_SWING_MS.normal, swing.sweep, now);
    sfx.swing(swing.finisher);

    // Resolve hits from where the step ends, so the swing lands where it's drawn.
    const ox = p.x + Math.cos(angle) * stepDist;
    const oy = p.y + Math.sin(angle) * stepDist;
    let hits = 0;
    let kills = 0;
    const struck = [];

    const inSwing = (x, y, radius) => {
      const dist = Phaser.Math.Distance.Between(ox, oy, x, y);
      if (dist > swing.range + radius) return false;
      if (dist < TUNING.player.radius + radius + 6) return true;
      return Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(y - oy, x - ox) - angle)) <= half;
    };

    // Swings delete enemy bullets.
    scene.cutBullets(inSwing);

    for (const enemy of [...scene.enemies.getChildren()]) {
      if (enemy.dying || !inSwing(enemy.x, enemy.y, enemy.radius)) continue;

      hits++;
      const dir = new Phaser.Math.Vector2(enemy.x - ox, enemy.y - oy);
      if (dir.lengthSq() < 0.01) dir.setToPolar(angle);
      dir.normalize();
      const hit = { damage: swing.damage, dir, knockback: swing.knockback, heavy: swing.finisher };
      if (scene.strikeEnemy(enemy, hit, now, swing.finisher ? 0.45 : 0.3)) kills++;
      else struck.push(enemy);
    }

    if (hits > kills) sfx.hit(swing.finisher);
    if (hits > 0) {
      scene.hitstop(swing.hitstopMs + (kills > 0 ? M.killHitstopBonusMs : 0), p, ...struck);
      scene.fx.shake(swing.shake);
    }
    this.gainPips(hits * this.cfg.ranged.hitPips);
  }

  gainPips(pips) {
    const R = this.cfg.ranged;
    const before = Math.floor(this.pips / R.pipsPerCharge);
    this.pips = Math.min(this.pips + pips, R.maxCharges * R.pipsPerCharge);
    if (Math.floor(this.pips / R.pipsPerCharge) > before) {
      this.scene.fx.readyRing(this.player, TUNING.player.radius, BOLT_TINT);
      sfx.shotReady();
    }
  }

  // Fire (right click) shoots one charged bolt, exactly where you aim. No charge, no shot.
  tryShoot(now) {
    const p = this.player;
    const scene = this.scene;
    const R = this.cfg.ranged;
    const c = p.controls;
    if (p.isDashing || now < this.nextShotAt || now - c.shootQueuedAt > R.bufferMs) return;
    c.shootQueuedAt = -Infinity;
    if (this.pips < R.pipsPerCharge) {
      sfx.shotEmpty();
      scene.hud.shakeResource(this.playerIndex);
      return;
    }
    this.pips -= R.pipsPerCharge;
    this.nextShotAt = now + R.cooldownMs;

    const angle = p.aimAngle;
    const muzzle = TUNING.player.radius + 12;
    const x = p.x + Math.cos(angle) * muzzle;
    const y = p.y + Math.sin(angle) * muzzle;

    // Configure after create(): the group resets body settings when it adopts a child.
    const bolt = scene.bolts.create(x, y, 'bolt').setScale(ART_SCALE);
    bolt.body.setCircle(4.5, 2.5, 0); // art pixels: radius 9 on screen, centered (the body doesn't rotate)
    bolt.trailTint = BOLT_TINT;
    bolt.trailCount = 3;
    bolt.setVelocity(Math.cos(angle) * R.speed, Math.sin(angle) * R.speed);
    bolt.setRotation(angle).setDepth(12).setBlendMode(Phaser.BlendModes.ADD);
    bolt.startX = x;
    bolt.startY = y;
    bolt.maxRange = R.range;
    bolt.cfg = R;
    bolt.pierced = new Set();

    p.body.velocity.add(new Phaser.Math.Vector2().setToPolar(angle, -R.recoil));
    sfx.shoot();
    scene.fx.hitSparks(x, y);
    scene.fx.shake(R.shake);
  }
}
