import Phaser from 'phaser';
import { TUNING } from '../../tuning.js';
import { Enemy } from './Enemy.js';
import { sfx } from '../../audio/sfx.js';
import { ART_SCALE } from '../../art.js';
import { pixelDisk, pixelSector } from '../../pixelShapes.js';
import { AIR_DEPTH } from '../depth.js';

const LUNGE_SECS = 0.1;
const CROUCH_SQUASH = 0.18;

// Up close: chase -> windup (red area fills up) -> swing -> recover -> chase.
// Mid range: chase -> crouch (landing circle follows its target) -> air (circle locked) -> slam ->
// landed (stuck, the opening to punish it) -> chase.
// Light hits only chip it; a heavy hit (combo finisher) staggers it and cancels a swing or crouch.
// The swing and slam also hit other enemies.
export class Brute extends Enemy {
  // type: a bigger enemy built on the brute (the warden) passes its own.
  constructor(scene, x, y, type = 'brute') {
    super(scene, x, y, type);
    this.cooldownLeft = 0;
    this.jumpCooldownLeft = 0;
    this.aim = 0;
    this.airborne = false;
    this.landing = new Phaser.Math.Vector2();
    this.bar = scene.add.graphics().setDepth(30);
    this.on('destroy', () => this.bar.destroy());
  }

  setupBody() {
    super.setupBody();
    this.bodyOffset = this.body.offset.clone();
  }

  think(player, dt) {
    const a = this.cfg.attack;
    const j = this.cfg.jump;
    this.cooldownLeft -= dt;
    this.jumpCooldownLeft -= dt;

    if (this.mode === 'chase') {
      super.think(player, dt);
      const gap = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y) - TUNING.player.radius;
      if (gap <= a.triggerRange && this.cooldownLeft <= 0) {
        this.aim = this.angleTo(player);
        this.enter('windup');
        this.windupSound = sfx.bruteWindup(this.x, this.y, a.windupMs / 1000);
      } else if (gap >= j.minRange && gap <= j.maxRange && this.jumpCooldownLeft <= 0) {
        this.enter('crouch');
        this.windupSound = sfx.bruteWindup(this.x, this.y, j.crouchMs / 1000);
      }
    } else if (this.mode === 'windup') {
      this.brake(dt);
      this.facing = this.aim;
      const progress = this.stateT * 1000 / a.windupMs;
      this.drawArea(Math.min(progress, 1));
      if (progress >= 1) this.swing();
    } else if (this.mode === 'recover') {
      if (this.stateT >= LUNGE_SECS) this.body.velocity.set(0, 0);
      if (this.stateT * 1000 >= a.recoveryMs) {
        this.cooldownLeft = a.cooldownMs / 1000;
        this.enter('chase');
      }
    } else if (this.mode === 'crouch') {
      this.brake(dt);
      this.aimLanding(player);
      this.facing = this.angleTo(this.landing);
      const progress = Math.min(this.stateT * 1000 / j.crouchMs, 1);
      this.setScale(this.baseScale * (1 + CROUCH_SQUASH * progress), this.baseScale * (1 - CROUCH_SQUASH * progress));
      this.drawLanding(progress * j.crouchMs / (j.crouchMs + j.airMs));
      if (progress >= 1) this.takeOff();
    } else if (this.mode === 'air') {
      const airSecs = j.airMs / 1000;
      const t = Math.min(this.stateT / airSecs, 1);
      this.setLift(j.height * 4 * t * (1 - t));
      // Re-aim at the landing spot every frame so bumping into a wall can't make it overshoot.
      const left = Math.max(airSecs - this.stateT, dt);
      this.body.velocity.set((this.landing.x - this.x) / left, (this.landing.y - this.y) / left);
      this.drawLanding((j.crouchMs + this.stateT * 1000) / (j.crouchMs + j.airMs));
      if (t >= 1) this.slam();
    } else if (this.mode === 'landed') {
      this.body.velocity.set(0, 0);
      if (this.stateT * 1000 >= j.recoverMs) {
        this.jumpCooldownLeft = j.cooldownMs / 1000;
        this.enter('chase');
      }
    }
  }

  // Lands where the player stands, but no further than maxLeap and never outside the world.
  aimLanding(player) {
    const j = this.cfg.jump;
    const { width: W, height: H } = TUNING.world;
    const leap = new Phaser.Math.Vector2(player.x - this.x, player.y - this.y).limit(j.maxLeap);
    this.landing.set(
      Phaser.Math.Clamp(this.x + leap.x, this.radius, W - this.radius),
      Phaser.Math.Clamp(this.y + leap.y, this.radius, H - this.radius),
    );
  }

  // Faint fill of the whole danger zone with a rim at its reach, plus a fill that grows outward as the
  // swing approaches.
  drawArea(progress) {
    const a = this.cfg.attack;
    const arc = Phaser.Math.DegToRad(a.arcDeg);
    const from = this.aim - arc / 2;
    const g = this.telegraph();
    g.fillStyle(0xff3040, 0.12);
    pixelSector(g, this.x, this.y, 0, a.reach - ART_SCALE, from, arc);
    g.fillStyle(0xff3040, 0.5);
    pixelSector(g, this.x, this.y, a.reach - ART_SCALE, a.reach, from, arc);
    g.fillStyle(0xff3040, 0.15 + progress * 0.25);
    pixelSector(g, this.x, this.y, 0, a.reach * progress, from, arc);
  }

  // Same look as the swing's area, as a circle on the landing spot. `progress` runs 0 -> 1 from the
  // start of the crouch to touchdown.
  drawLanding(progress) {
    const { x, y } = this.landing;
    const r = this.cfg.jump.radius;
    const g = this.telegraph();
    g.fillStyle(0xff3040, 0.12);
    pixelDisk(g, x, y, r - ART_SCALE);
    g.fillStyle(0xff3040, 0.5);
    pixelSector(g, x, y, r - ART_SCALE, r);
    g.fillStyle(0xff3040, 0.15 + progress * 0.25);
    pixelDisk(g, x, y, r * progress);
  }

  // Is a circle at (x, y) with this radius inside the swing?
  inSwing(x, y, radius) {
    const a = this.cfg.attack;
    const dx = x - this.x;
    const dy = y - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist > a.reach + radius) return false;
    if (dist <= this.radius + radius) return true;
    return Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - this.aim)) <= Phaser.Math.DegToRad(a.arcDeg) / 2;
  }

  swing() {
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

    scene.hitEnemies(this, this.x, this.y, (e) => this.inSwing(e.x, e.y, e.radius), this.cfg.friendlyFire);
    for (const player of scene.livingPlayers()) {
      if (!this.inSwing(player.x, player.y, TUNING.player.radius)) continue;
      const dir = new Phaser.Math.Vector2(player.x - this.x, player.y - this.y).normalize();
      scene.damagePlayer(player, a.damage, dir, a.knockback, this);
    }
    this.enter('recover');
  }

  takeOff() {
    this.stopWindupSound();
    this.setScale(this.baseScale);
    this.airborne = true;
    sfx.bruteJump(this.x, this.y);
    this.scene.fx.hitSparks(this.x, this.y + this.radius);
    this.enter('air');
  }

  slam() {
    const j = this.cfg.jump;
    const scene = this.scene;
    this.land();
    this.clearTelegraph();
    sfx.bruteSlam(this.x, this.y);
    scene.fx.slam(this.x, this.y, j.radius, 0xff6b6b);
    scene.fx.shake(j.shake);
    scene.fx.squash(this, 0.35, 160);

    const inSlam = (x, y, radius) => Phaser.Math.Distance.Between(this.x, this.y, x, y) <= j.radius + radius;
    scene.hitEnemies(this, this.x, this.y, (e) => inSlam(e.x, e.y, e.radius), this.cfg.friendlyFire);
    for (const player of scene.livingPlayers()) {
      if (!inSlam(player.x, player.y, TUNING.player.radius)) continue;
      const dir = new Phaser.Math.Vector2(player.x - this.x, player.y - this.y);
      if (dir.lengthSq() < 0.01) dir.setToPolar(this.facing);
      scene.damagePlayer(player, j.damage, dir.normalize(), j.knockback, this);
    }
    this.enter('landed');
  }

  land() {
    this.airborne = false;
    this.setLift(0);
    this.body.velocity.set(0, 0);
  }

  // Draws the sprite `px` above its body. The body and shadow stay on the ground: shifting the origin
  // alone would drag the body along, so its offset moves by the same amount.
  setLift(px) {
    const d = px / this.baseScale;
    this.setOrigin(this.art.center.x / this.width, (this.art.center.y + d) / this.height);
    this.body.setOffset(this.bodyOffset.x, this.bodyOffset.y + d);
  }

  onHit(hit, now) {
    if (this.airborne) return; // can still be damaged mid-leap, but nothing knocks it out of the air
    if (hit.heavy) {
      this.knock(hit.dir, hit.knockback * this.cfg.heavyKnockbackScale, now, this.cfg.staggerMs);
      sfx.bruteStagger(this.x, this.y);
    } else {
      this.body.velocity.add(hit.dir.clone().scale(hit.knockback * 0.1));
    }
  }

  interrupt() {
    if (this.mode === 'crouch') this.jumpCooldownLeft = this.cfg.jump.cooldownMs / 2000;
    else if (this.mode === 'landed') this.jumpCooldownLeft = this.cfg.jump.cooldownMs / 1000;
    else this.cooldownLeft = this.cfg.attack.cooldownMs / 2000;
    super.interrupt();
    this.setScale(this.baseScale);
  }

  syncVisuals() {
    super.syncVisuals();
    if (this.airborne) this.setDepth(AIR_DEPTH);
    const g = this.bar.clear();
    if (this.hp >= this.cfg.hp || this.dying) return;
    const w = 40;
    const x = this.x - w / 2;
    const y = this.top - 4;
    g.fillStyle(0x000000, 0.6).fillRect(x - 1, y - 1, w + 2, 6);
    g.fillStyle(0xff4d6d).fillRect(x, y, w * Math.max(this.hp, 0) / this.cfg.hp, 4);
  }

  die() {
    this.bar.clear();
    if (this.airborne) this.land(); // shot down mid-leap: die on the ground, where the blood lands
    super.die();
  }
}
