import Phaser from 'phaser';
import { TUNING } from '../tuning.js';
import { sfx } from '../audio/sfx.js';
import { HeroClass } from './HeroClass.js';
import { ART_SCALE } from '../art.js';
import { FIRE_TINT, ZAP_TINT, shadowTexture } from '../textures.js';
import { SHADOW_DEPTH } from '../entities/Shadow.js';
import { fillPixels, pixelDisk, pixelSector } from '../pixelShapes.js';

export const MANA_TINT = 0x5c8dff;
const BLINK_TINT = 0xc9a0ff;
const MIN_PAD_REACH = 0.15; // a barely tilted stick still aims this fraction of the way out
const STAFF_FLICK_DEG = 70; // the staff starts this far to one side of the aim on a cast
const GROUND_FIRE_DEPTH = 1.5; // above the blood stains, below shadows and characters
const GROUND_FLICKER_MS = 90;  // the burning ground's pixels reshuffle this often
// The burning ground's pixels: each color takes a band of the 0..1 noise (see burnGround()).
const GROUND_FLAMES = [[0xc4361b, 0.0, 0.1], [FIRE_TINT, 0.1, 0.16], [0xffd34d, 0.16, 0.19]];

// Ranged and fragile: a stream of weak zaps fills the mana bar, and mana pays for fireballs (lobbed to
// the cursor, they explode, set enemies burning and leave the ground on fire) and blinks. Mana never
// refills on its own, so the mage has to keep zapping to cast.
export class Mage extends HeroClass {
  static id = 'mage';
  static title = 'Mage';
  static heroes = ['wizzard_m', 'wizzard_f'];
  static weapon = { frame: 'weapon_red_magic_staff', originY: 0.85 };
  static hud = 'mana';
  static controls = [
    { action: 'Move', kbm: 'WSAD', pad: 'Left stick' },
    { action: 'Aim', kbm: 'Mouse', pad: 'Right stick' },
    { action: 'Zap - hits charge mana', kbm: 'Left click', pad: 'RB' },
    { action: 'Fireball - mana', kbm: 'Right click', pad: 'LB' },
    { action: 'Blink - mana', kbm: 'Space', pad: 'RT / A' },
  ];

  constructor(scene, player) {
    super(scene, player);
    this.mana = this.cfg.mana.start;
    this.nextZapAt = 0;
    this.nextFireballAt = 0;
    this.nextBlinkAt = 0;
    this.blinkShown = true; // whether the blink-back ring has played since the last blink
    this.side = 1; // casts alternate which way the staff flicks
    this.reticle = scene.add.graphics().setDepth(4); // where a fireball would land, for a stick
    player.on('destroy', () => this.reticle.destroy());
    // Fireballs in flight and fire left on the ground: each is update(now, dt), returning true when
    // it's done. They run from the scene's update, so they carry on while the mage is in hitstop, hurt
    // or dead.
    this.spells = [];
    scene.events.on('update', this.updateSpells, this);
    scene.events.once('shutdown', () => scene.events.off('update', this.updateSpells, this));
  }

  updateSpells(_time, delta) {
    if (this.scene.isOver) return;
    const now = this.scene.time.now;
    const dt = Math.min(delta, 50) / 1000;
    // A spell can start another (a landing fireball leaves fire on the ground), so the list is edited
    // in place rather than replaced.
    for (const spell of [...this.spells]) {
      if (spell(now, dt)) this.spells.splice(this.spells.indexOf(spell), 1);
    }
  }

  get hudValue() {
    return this.mana;
  }

  update(now, dt) {
    const p = this.player;
    this.tryBlink(now);
    p.move(p.controls.move, dt, now);
    this.tryZap(now);
    this.tryFireball(now);
    if (!this.blinkShown && now >= this.nextBlinkAt) {
      this.blinkShown = true;
      this.scene.fx.readyRing(p, TUNING.player.radius, BLINK_TINT);
      sfx.dashReady(this.player);
    }
  }

  // Where the aim points, at most `range` away and inside the world: the cursor, or along the stick
  // as far as it's tilted (all the way when it's let go).
  aimTarget(range) {
    const p = this.player;
    const c = p.controls;
    const to = c.aimPoint
      ? new Phaser.Math.Vector2(c.aimPoint.x - p.x, c.aimPoint.y - p.y).limit(range)
      : new Phaser.Math.Vector2().setToPolar(p.aimAngle, range * Math.max(c.aimReach ?? 1, MIN_PAD_REACH));
    to.add(p);
    const { width: W, height: H } = TUNING.world;
    const edge = TUNING.player.radius;
    return to.set(Phaser.Math.Clamp(to.x, edge, W - edge), Phaser.Math.Clamp(to.y, edge, H - edge));
  }

  // Takes a buffered press (see Controls) if it's within bufferMs and the move is off cooldown. Presses
  // wait out a hurt stun.
  takePress(now, key, bufferMs, readyAt) {
    const c = this.player.controls;
    if (now - c[key] > bufferMs || now < readyAt || now < this.player.stunUntil) return false;
    c[key] = -Infinity;
    return true;
  }

  // Spends `cost` mana, or rattles the bar and returns false if there isn't enough.
  spend(cost) {
    if (this.mana < cost) {
      sfx.shotEmpty(this.player);
      this.scene.hud.shakeResource(this.playerIndex);
      return false;
    }
    this.mana -= cost;
    return true;
  }

  // Adds mana, with a ring and a chime when there's enough again for a fireball.
  gainMana(amount) {
    const before = this.mana;
    this.mana = Math.min(this.mana + amount, this.cfg.mana.max);
    const cost = this.cfg.fireball.cost;
    if (before < cost && this.mana >= cost) {
      this.scene.fx.readyRing(this.player, TUNING.player.radius, MANA_TINT);
      sfx.shotReady(this.player);
    }
  }

  flickStaff(angle, now) {
    const p = this.player;
    this.side = -this.side;
    const from = angle - this.side * Phaser.Math.DegToRad(STAFF_FLICK_DEG);
    p.swingWeapon(from, angle + this.side * Phaser.Math.DegToRad(65), 120, this.side, now);
  }

  // Attack (left click, held for auto-fire) shoots a zap roughly toward the aim. Each enemy a zap hits
  // adds mana.
  tryZap(now) {
    const p = this.player;
    const c = p.controls;
    const Z = this.cfg.zap;
    if (now < this.nextZapAt || now < p.stunUntil) return;
    if (!c.attackHeld && now - c.attackQueuedAt > Z.bufferMs) return;
    c.attackQueuedAt = -Infinity;
    this.nextZapAt = now + Z.cooldownMs;

    const scene = this.scene;
    const angle = p.aimAngle + Phaser.Math.DegToRad(Phaser.Math.FloatBetween(-Z.spreadDeg, Z.spreadDeg));
    const muzzle = TUNING.player.radius + 10;
    const x = p.x + Math.cos(angle) * muzzle;
    const y = p.y + Math.sin(angle) * muzzle;

    // Configure after create(): the group resets body settings when it adopts a child.
    const zap = scene.bolts.create(x, y, 'zap-0').setScale(ART_SCALE).play('zap');
    zap.body.setCircle(3, 3, 0.5); // art pixels: radius 6 on screen, centered (the body doesn't rotate)
    zap.trailTint = ZAP_TINT;
    zap.trailCount = 2;
    zap.setVelocity(Math.cos(angle) * Z.speed, Math.sin(angle) * Z.speed);
    zap.setRotation(angle).setDepth(12).setBlendMode(Phaser.BlendModes.ADD);
    zap.startX = x;
    zap.startY = y;
    zap.maxRange = Z.range;
    zap.cfg = Z;
    zap.pierced = new Set();
    zap.owner = this.player;
    zap.hitSound = 'zapHit';
    zap.onHit = () => this.gainMana(Z.mana);

    scene.fx.projectileTrail(x, y, ZAP_TINT, 3);
    sfx.zap(this.player);
  }

  // Fire (right click) lobs a fireball onto the aim.
  tryFireball(now) {
    const F = this.cfg.fireball;
    if (!this.takePress(now, 'shootQueuedAt', F.bufferMs, this.nextFireballAt) || !this.spend(F.cost)) return;
    this.nextFireballAt = now + F.cooldownMs;

    const scene = this.scene;
    const p = this.player;
    const to = this.aimTarget(F.range);
    const from = new Phaser.Math.Vector2(p.x, p.y);
    const reach = Phaser.Math.Distance.BetweenPoints(from, to) / F.range;
    const height = F.height * Math.max(reach, 0.3);
    const ball = scene.add.sprite(p.x, p.y, 'fireball-0').setScale(ART_SCALE).setDepth(12).play('fireball');
    const shadow = scene.add.image(p.x, p.y, shadowTexture(scene, 10)).setScale(ART_SCALE).setAlpha(0.3).setDepth(SHADOW_DEPTH);
    // A ring on the floor where it'll land, the size of the blast, filling in as it falls.
    const marker = scene.add.graphics().setDepth(4);

    const secs = (F.minAirMs + (F.maxAirMs - F.minAirMs) * reach) / 1000;
    let flown = 0;
    this.spells.push((_now, dt) => {
      flown += dt;
      const t = Math.min(flown / secs, 1);
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      const lift = height * 4 * t * (1 - t);
      ball.setPosition(x, y - lift);
      shadow.setPosition(x, y + 6);
      scene.fx.projectileTrail(x, y - lift, FIRE_TINT, 4);
      marker.clear().fillStyle(FIRE_TINT, 0.15 + 0.35 * t);
      pixelSector(marker, to.x, to.y, F.radius - 2 * ART_SCALE, F.radius);
      if (t < 1) return false;
      ball.destroy();
      shadow.destroy();
      marker.destroy();
      this.explode(to.x, to.y);
      return true;
    });

    this.flickStaff(Math.atan2(to.y - p.y, to.x - p.x), now);
    sfx.fireballThrow(this.player);
  }

  // The fireball lands: hit and ignite everything in the blast, and leave the ground burning.
  explode(x, y) {
    const scene = this.scene;
    const now = scene.time.now;
    const F = this.cfg.fireball;
    const inBlast = (ex, ey, r) => Phaser.Math.Distance.Between(x, y, ex, ey) <= F.radius + r;
    scene.cutBullets(inBlast);
    const struck = [];
    for (const enemy of [...scene.enemies.getChildren()]) {
      if (enemy.dying || enemy.airborne || !inBlast(enemy.x, enemy.y, enemy.radius)) continue;
      const dir = new Phaser.Math.Vector2(enemy.x - x, enemy.y - y);
      if (dir.lengthSq() < 0.01) dir.setToPolar(Math.random() * Math.PI * 2);
      dir.normalize();
      if (!scene.strikeEnemy(enemy, { damage: F.damage, dir, knockback: F.knockback }, now, 0.35)) {
        enemy.ignite(now, F.burn);
        struck.push(enemy);
      }
    }

    sfx.fireballBoom(x, y);
    scene.fx.slam(x, y, F.radius, FIRE_TINT);
    scene.fx.shake(F.shake, this.player);
    if (struck.length > 0) scene.hitstop(F.hitstopMs, ...struck);
    this.burnGround(x, y);
  }

  // A patch of fire on the floor, as wide as the blast, for ground.durationMs. Every frame it ignites the enemies standing in
  // it, which keeps their burn topped up for as long as they stay.
  burnGround(x, y) {
    const scene = this.scene;
    const F = this.cfg.fireball;
    const { radius } = F;
    const { durationMs } = F.ground;
    const g = scene.add.graphics().setDepth(GROUND_FIRE_DEPTH);
    let age = 0;
    this.spells.push((now, dt) => {
      age += dt * 1000;
      if (age >= durationMs) {
        g.destroy();
        return true;
      }
      for (const enemy of scene.enemies.getChildren()) {
        if (enemy.dying || enemy.airborne) continue;
        if (Phaser.Math.Distance.Between(x, y, enemy.x, enemy.y) <= radius + enemy.radius / 2) enemy.ignite(now, F.burn);
      }

      // Flickering embers over a dim glow, both thinning out over the last third.
      const t = age / durationMs;
      const fade = t < 2 / 3 ? 1 : 1 - (t - 2 / 3) * 3;
      const step = Math.floor(now / GROUND_FLICKER_MS);
      const r2 = radius * radius;
      g.clear().fillStyle(FIRE_TINT, 0.18 * fade);
      pixelDisk(g, x, y, radius);
      for (const [color, from, to] of GROUND_FLAMES) {
        g.fillStyle(color, 0.85 * fade);
        fillPixels(g, x, y, radius, (px, py) => {
          const d2 = (px - x) ** 2 + (py - y) ** 2;
          if (d2 > r2) return false;
          // Denser toward the middle.
          const n = noise(px, py, step) * (0.55 + 0.45 * Math.sqrt(d2 / r2));
          return n >= from && n < to;
        });
      }
      if (Math.random() < 0.6 * fade) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * radius;
        scene.fx.ember(x + Math.cos(a) * d, y + Math.sin(a) * d, 4);
      }
      return false;
    });
  }

  // Dash (Space) teleports to the aim, at most blink.range away.
  tryBlink(now) {
    const B = this.cfg.blink;
    if (!this.takePress(now, 'dashQueuedAt', B.bufferMs, this.nextBlinkAt) || !this.spend(B.cost)) return;
    this.nextBlinkAt = now + B.cooldownMs;
    this.blinkShown = false;

    const scene = this.scene;
    const p = this.player;
    const to = this.aimTarget(B.range);
    scene.fx.afterimage(p, BLINK_TINT);
    scene.fx.hitSparks(p.x, p.y);
    p.stepLeft = 0;
    p.setPosition(to.x, to.y); // the body follows at the next physics step
    p.shield(now + B.invulnMs);
    scene.fx.hitSparks(p.x, p.y);
    scene.fx.readyRing(p, TUNING.player.radius, BLINK_TINT);
    scene.fx.squash(p, 0.3, 120);
    sfx.blink(this.player);
  }

  // With a stick, a small ring where a fireball would land, since there's no cursor to show it.
  syncVisuals() {
    const g = this.reticle.clear();
    if (this.player.controls.aimPoint) return;
    const to = this.aimTarget(this.cfg.fireball.range);
    g.fillStyle(FIRE_TINT, 0.6);
    pixelSector(g, to.x, to.y, 6, 6 + ART_SCALE);
  }
}

// A repeatable 0..1 value for the pixel at (x, y) at flicker step `step`.
function noise(x, y, step) {
  const v = Math.sin(x * 12.9898 + y * 78.233 + step * 37.719) * 43758.5453;
  return v - Math.floor(v);
}
