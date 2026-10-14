import Phaser from 'phaser';
import { TUNING } from '../../tuning.js';
import { ENEMY_PAD } from '../../textures.js';

// Base enemy: walks at the player. Subclasses override think() and use enter()/stateT for simple
// state machines. stateT counts seconds of unfrozen time, so hitstop doesn't eat telegraphs.
export class Enemy extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, type) {
    super(scene, x, y, `enemy-${type}`);
    this.type = type;
    this.cfg = TUNING.enemies[type];
    this.radius = this.cfg.radius;
    scene.add.existing(this);
    this.setDepth(5);

    this.hp = this.cfg.hp;
    this.stunUntil = 0;
    this.spawnGraceUntil = scene.time.now + TUNING.spawn.graceMs;
    this.dying = false;
    this.mode = 'chase';
    this.stateT = 0;
    this.telegraphGfx = null;
    this.windupSound = null; // handle of a telegraph sound to cut off if interrupted
    this.on('destroy', () => this.telegraphGfx?.destroy());
  }

  // Call after adding to a physics group: the group resets body settings when it adopts a child.
  setupBody() {
    this.body.setCircle(this.radius, ENEMY_PAD, ENEMY_PAD);
    this.body.setMass(this.cfg.mass);
    this.setCollideWorldBounds(true);
    this.setScale(0);
    this.scene.tweens.add({ targets: this, scale: 1, duration: 220, ease: 'Back.easeOut' });
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
    if (v.lengthSq() > 1) this.setRotation(Math.atan2(v.y, v.x));
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

  syncVisuals() {}

  die() {
    this.dying = true;
    this.body.enable = false;
    this.stopWindupSound();
    this.clearTelegraph();
    this.setAlpha(1).setTintFill(0xffffff);
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
