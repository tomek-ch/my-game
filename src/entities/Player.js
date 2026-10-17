import Phaser from 'phaser';
import { TUNING } from '../tuning.js';
import { AIR_DEPTH, ySortDepth } from './depth.js';
import { ART_SCALE } from '../art.js';
import { Shadow } from './Shadow.js';
import { isFrozen } from './hitstop.js';

const T = TUNING.player;

// The hero frames are 16x28 art pixels. The hit circle covers the lower body, and the origin sits at
// the circle's center so x/y mean the same thing they did for the old round placeholder.
const BODY_CENTER = { x: 8, y: 21 };
const HAND = { x: 3, y: -2 };   // art pixels from BODY_CENTER, facing right
const RUN_MIN_SPEED = 20;       // px/s; slower than this shows the idle loop

// The weapon rests this far to one side of the aim and sweeps to the other side on each swing.
const WEAPON_REST = Phaser.Math.DegToRad(65);
const WEAPON_SETTLE = 18;       // how fast it eases back to rest (per second, exponential)

// Eases `vel` toward `dir` (a normalized input vector, or zero) times the player's top speed: walking,
// with no dash, step or stun. Also used online to move the guest's own player ahead of the host.
export function steerVelocity(vel, dir, dt) {
  const target = new Phaser.Math.Vector2(dir.x, dir.y).scale(T.maxSpeed);
  const hasInput = dir.lengthSq() > 0;
  let rate = hasInput ? T.accel : T.decel;
  if (hasInput && vel.dot(target) < 0) rate = T.turnAccel;

  const diff = target.subtract(vel);
  const step = rate * dt;
  if (diff.length() <= step) vel.add(diff);
  else vel.add(diff.setLength(step));
}

// One player's body: movement, health, the dash, and the art. What the buttons do is up to its class
// (see src/classes/), which is created with the player as `kit`.
export class Player extends Phaser.Physics.Arcade.Sprite {
  // hero: which character art to use, e.g. 'knight_m'. weapon: { frame, originY } of the held weapon's
  // art, pointing up with the grip at originY. controls: what drives this player.
  constructor(scene, x, y, { hero, weapon, controls }) {
    super(scene, x, y, 'dungeon', `${hero}_idle_anim_f0`);
    this.hero = hero;
    this.controls = controls;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.baseScale = ART_SCALE;
    const r = T.radius / ART_SCALE;
    this.setScale(ART_SCALE).setOrigin(BODY_CENTER.x / this.width, BODY_CENTER.y / this.height);
    this.body.setCircle(r, BODY_CENTER.x - r, BODY_CENTER.y - r);
    this.play(`${hero}_idle`);
    this.shadow = new Shadow(this, 12, T.radius);
    this.setCollideWorldBounds(true);
    this.setDepth(ySortDepth(y));

    this.hp = T.maxHp;
    this.dead = false;
    this.aimAngle = 0;
    this.invulnUntil = 0;
    this.stunUntil = 0;
    this.stepLeft = 0; // seconds of attack step remaining, only counts down while unfrozen
    this.stepVel = new Phaser.Math.Vector2();
    this.dashLeft = 0; // seconds, like stepLeft
    this.dashVel = new Phaser.Math.Vector2();
    this.nextDashAt = 0;
    this.dashExitSpeed = 0;
    this.lift = 0; // px the sprite is drawn above the ground, see setLift()
    this.dashInvulnUntil = 0;
    this.dashGraceMs = 0; // how long the dash in progress keeps you untouchable after it ends

    this.weapon = scene.add.image(x, y, 'dungeon', weapon.frame).setScale(ART_SCALE).setOrigin(0.5, weapon.originY);
    this.weaponSide = -1;    // which side of the aim it rests on: -1 or 1
    this.weaponAngle = -WEAPON_REST;
    this.weaponSwing = null; // { from, to, startedAt, ms } while a swing is playing
    this.lastSyncAt = scene.time.now;
  }

  // dir is a normalized input vector (or zero). Velocity eases toward dir * maxSpeed.
  move(dir, dt, now) {
    const vel = this.body.velocity;
    if (this.dashLeft > 0) {
      this.dashLeft -= dt;
      if (this.dashLeft > 0) vel.copy(this.dashVel);
      else {
        vel.copy(this.dashVel).setLength(this.dashExitSpeed);
        this.shield(now + this.dashGraceMs);
      }
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
    steerVelocity(vel, dir, dt);
  }

  get alive() {
    return !this.dead;
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

  // cfg: { distance, durationMs, cooldownMs, invulnGraceMs, exitSpeed }, see TUNING.classes.knight.dash.
  dash(angle, now, cfg) {
    this.stepLeft = 0;
    this.dashLeft = cfg.durationMs / 1000;
    this.dashVel.setToPolar(angle, cfg.distance / this.dashLeft);
    this.dashExitSpeed = cfg.exitSpeed;
    this.dashGraceMs = cfg.invulnGraceMs;
    this.nextDashAt = now + cfg.durationMs + cfg.cooldownMs;
    this.dashInvulnUntil = now + cfg.durationMs + cfg.invulnGraceMs;
  }

  // Draws the sprite `px` above its body, for jumps. The body (so x/y) and the shadow stay on the
  // ground: the origin moves up, and the body's offset with it so it doesn't get dragged along.
  setLift(px) {
    const d = px / ART_SCALE;
    const r = T.radius / ART_SCALE;
    this.lift = px;
    this.setOrigin(BODY_CENTER.x / this.width, (BODY_CENTER.y + d) / this.height);
    this.body.setOffset(BODY_CENTER.x - r, BODY_CENTER.y - r + d);
  }

  // Untouchable until `until`, without the hurt blink.
  shield(until) {
    this.dashInvulnUntil = Math.max(this.dashInvulnUntil, until);
  }

  // Ends a dash right away, keeping the current velocity.
  stopDash() {
    this.dashLeft = 0;
  }

  hurt(damage, dir, now, knockback = T.hurtKnockback) {
    this.stepLeft = 0;
    this.dashLeft = 0;
    this.hp -= damage;
    this.invulnUntil = now + T.invulnMs;
    this.stunUntil = now + T.hurtStunMs;
    this.body.velocity.copy(dir).scale(knockback);
  }

  // A dash keeps you untouchable however long hitstop stretches it, and for its grace after it ends.
  isInvulnerable(now) {
    return now < this.invulnUntil || now < this.dashInvulnUntil || this.isDashing;
  }

  // Sweep the weapon from one angle to another over `ms`, then let it settle at rest on `side` of the
  // aim (-1 or 1).
  swingWeapon(from, to, ms, side, now) {
    this.weaponSwing = { from, to, startedAt: now, ms };
    this.weaponSide = side;
  }

  syncVisuals(now) {
    const dt = Math.min(now - this.lastSyncAt, 50) / 1000;
    this.lastSyncAt = now;
    this.shadow.sync();

    const blink = now < this.invulnUntil && Math.floor(now / 60) % 2 === 0;
    this.setAlpha(blink ? 0.35 : 1);
    this.setFlipX(Math.cos(this.aimAngle) < 0);
    this.setDepth(this.lift > 0 ? AIR_DEPTH : ySortDepth(this.y));
    this.syncAnimation(now);
    this.syncWeapon(now, dt);
    this.weapon.setAlpha(this.alpha);
  }

  syncAnimation(now) {
    if (now < this.stunUntil) {
      this.anims.stop();
      this.setFrame(`${this.hero}_hit_anim_f0`);
      return;
    }
    if (isFrozen(this, now)) return; // paused until the hitstop ends
    const speed = this.body.velocity.length();
    if (speed < RUN_MIN_SPEED) {
      this.play(`${this.hero}_idle`, true);
      this.anims.timeScale = 1;
    } else {
      this.play(`${this.hero}_run`, true);
      this.anims.timeScale = Phaser.Math.Clamp(speed / T.maxSpeed, 0.6, 1.6);
    }
  }

  syncWeapon(now, dt) {
    const facing = this.flipX ? -1 : 1;
    this.weapon.setPosition(
      this.x + HAND.x * facing * ART_SCALE,
      this.y + HAND.y * ART_SCALE - this.lift,
    );

    const swing = this.weaponSwing;
    if (swing) {
      const t = Math.min((now - swing.startedAt) / swing.ms, 1);
      this.weaponAngle = swing.from + (swing.to - swing.from) * Phaser.Math.Easing.Cubic.Out(t);
      if (t >= 1) this.weaponSwing = null;
    } else {
      const rest = this.aimAngle + this.weaponSide * WEAPON_REST;
      const diff = Phaser.Math.Angle.Wrap(rest - this.weaponAngle);
      this.weaponAngle += diff * Math.min(1, WEAPON_SETTLE * dt);
    }

    // The art points up, so add a quarter turn. Pointing away from the camera, it goes behind the hero.
    this.weapon.setRotation(this.weaponAngle + Math.PI / 2);
    this.weapon.setDepth(this.depth + (Math.sin(this.weaponAngle) < -0.2 ? -0.0001 : 0.0001));
  }

  // Grey out and freeze on death. The body goes too, so nothing hits or targets the corpse.
  die() {
    this.dead = true;
    this.body.stop();
    this.body.enable = false;
    this.anims.stop();
    this.setFrame(`${this.hero}_hit_anim_f0`);
    this.setAlpha(1).setTint(0x555566);
    this.weapon.setAlpha(1).setTint(0x555566);
    // No class effects on a corpse, like the berserker's rage glow.
    this.preFX?.clear();
    this.weapon.preFX?.clear();
  }
}
