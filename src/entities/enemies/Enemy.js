import Phaser from 'phaser';
import { TUNING } from '../../tuning.js';
import { ART_SCALE, ENEMY_ART } from '../../art.js';
import { ySortDepth } from '../depth.js';

// Base enemy: walks at the player. Subclasses override think() and use enter()/stateT for simple
// state machines. stateT counts seconds of unfrozen time, so hitstop doesn't eat telegraphs.
const RUN_MIN_SPEED = 20; // px/s; slower than this shows the idle loop

export class Enemy extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, type) {
    const art = ENEMY_ART[type];
    super(scene, x, y, 'dungeon', `${art.monster}_run_anim_f0`);
    this.type = type;
    this.cfg = TUNING.enemies[type];
    this.radius = this.cfg.radius;
    this.art = art;
    this.baseScale = ART_SCALE;
    this.setOrigin(art.center.x / this.width, art.center.y / this.height);
    this.play(`${art.monster}_idle`);
    scene.add.existing(this);
    this.setDepth(ySortDepth(y));

    this.hp = this.cfg.hp;
    this.stunUntil = 0;
    this.spawnGraceUntil = scene.time.now + TUNING.spawn.graceMs;
    this.dying = false;
    this.mode = 'chase';
    this.stateT = 0;
    this.facing = 0; // radians; logic reads this, never the sprite's rotation
    this.telegraphGfx = null;
    this.windupSound = null; // handle of a telegraph sound to cut off if interrupted
    this.on('destroy', () => this.telegraphGfx?.destroy());
  }

  // Call after adding to a physics group: the group resets body settings when it adopts a child.
  setupBody() {
    const r = this.radius / ART_SCALE;
    this.body.setCircle(r, this.art.center.x - r, this.art.center.y - r);
    this.body.setMass(this.cfg.mass);
    this.setCollideWorldBounds(true);
    this.setScale(0);
    this.scene.tweens.add({ targets: this, scale: this.baseScale, duration: 220, ease: 'Back.easeOut' });
  }

  enter(mode) {
    this.mode = mode;
    this.stateT = 0;
  }

  isStunned(now) {
    return now < this.stunUntil;
  }

  tick(player, dt, now) {
    this.stateT += dt;
    if (this.isStunned(now)) {
      this.body.velocity.scale(Math.exp(-this.cfg.knockbackFriction * dt));
      if (this.mode !== 'chase') this.interrupt();
      return;
    }
    this.think(player, dt, now);
  }

  // Called when a stun cuts off whatever the enemy was doing.
  interrupt() {
    this.stopWindupSound();
    this.clearTelegraph();
    this.clearTint();
    this.setAlpha(1);
    this.enter('chase');
  }

  think(player, dt) {
    this.steer(player.x - this.x, player.y - this.y, this.cfg.maxSpeed, dt);
    this.faceVelocity();
  }

  // Ease velocity toward (dx, dy) scaled to `speed`.
  steer(dx, dy, speed, dt) {
    const desired = new Phaser.Math.Vector2(dx, dy);
    if (desired.lengthSq() > 0) desired.setLength(speed);
    this.steerToward(desired, dt);
  }

  brake(dt) {
    this.steerToward(new Phaser.Math.Vector2(), dt);
  }

  steerToward(desired, dt) {
    const vel = this.body.velocity;
    const diff = desired.subtract(vel);
    const step = this.cfg.accel * dt;
    if (diff.length() <= step) vel.add(diff);
    else vel.add(diff.setLength(step));
  }

  faceVelocity() {
    const v = this.body.velocity;
    if (v.lengthSq() > 1) this.facing = Math.atan2(v.y, v.x);
  }

  angleTo(target) {
    return Math.atan2(target.y - this.y, target.x - this.x);
  }

  knock(dir, force, now, stunMs = this.cfg.stunMs) {
    this.body.velocity.copy(dir).scale(force);
    this.stunUntil = Math.max(this.stunUntil, now + stunMs);
  }

  // What touching the player does right now: { damage, knockback } or null for harmless.
  contact(now) {
    if (this.dying || now < this.spawnGraceUntil || this.isStunned(now) || !this.cfg.contactDamage) return null;
    return { damage: this.cfg.contactDamage, knockback: TUNING.player.hurtKnockback };
  }

  // hit: { damage, dir, knockback, stunMs?, heavy? }. Returns true when this hit kills it.
  takeHit(hit, now) {
    this.hp -= hit.damage;
    this.onHit(hit, now);
    return this.hp <= 0;
  }

  onHit(hit, now) {
    this.knock(hit.dir, hit.knockback, now, hit.stunMs ?? this.cfg.stunMs);
  }

  telegraph() {
    this.telegraphGfx ??= this.scene.add.graphics().setDepth(4);
    return this.telegraphGfx.clear();
  }

  clearTelegraph() {
    this.telegraphGfx?.clear();
  }

  stopWindupSound() {
    this.windupSound?.stop();
    this.windupSound = null;
  }

  // Top edge of the sprite's frame, for things drawn above the enemy.
  get top() {
    return this.y - this.displayOriginY * this.baseScale;
  }

  syncVisuals() {
    this.setFlipX(Math.cos(this.facing) < 0);
    this.setDepth(ySortDepth(this.y));
    const speed = this.body.velocity.length();
    const moving = speed >= RUN_MIN_SPEED;
    this.play(`${this.art.monster}_${moving ? 'run' : 'idle'}`, true);
    this.anims.timeScale = moving ? Phaser.Math.Clamp(speed / this.cfg.maxSpeed, 0.6, 2) : 1;
  }

  die() {
    this.dying = true;
    this.body.enable = false;
    this.stopWindupSound();
    this.clearTelegraph();
    this.setAlpha(1).setTintFill(0xffffff);
    this.scene.tweens.add({
      targets: this,
      scale: this.baseScale * 1.6,
      alpha: 0,
      duration: 140,
      ease: 'Quad.easeOut',
      onComplete: () => this.destroy(),
    });
  }
}
