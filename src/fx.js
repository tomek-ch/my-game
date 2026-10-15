import Phaser from 'phaser';
import { TUNING } from './tuning.js';
import { ART_SCALE } from './art.js';
import { BLOOD, SPLAT_VARIANTS } from './textures.js';
import { pixelSector } from './pixelShapes.js';

const S = ART_SCALE;
const BLOOD_DEPTH = 1;    // stains: above the floor, below shadows and characters
const BLOOD_GRAVITY = 700; // droplets arc up and fall back to the floor

// Visual juice: particles, blood, slashes, flashes, shake.
export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.sparks = scene.add.particles(0, 0, 'px', {
      speed: { min: 140, max: 340 },
      lifespan: { min: 100, max: 240 },
      scale: { start: S * 2, end: S },
      emitting: false,
    }).setDepth(20);

    // Everything that lands stays: stains are drawn into one floor-sized texture at art resolution.
    const { width: W, height: H } = TUNING.world;
    this.stains = scene.add.renderTexture(0, 0, W / S, H / S).setOrigin(0).setScale(S).setDepth(BLOOD_DEPTH);

    this.blood = scene.add.particles(0, 0, 'px', {
      speedX: { min: -170, max: 170 },
      speedY: { min: -320, max: -60 },
      gravityY: BLOOD_GRAVITY,
      lifespan: { min: 280, max: 520 },
      scale: [S, S, S * 2],
      tint: BLOOD,
      emitting: false,
      deathCallback: (p) => this.stain(p.x, p.y, p.scaleX / S, p.tint),
    }).setDepth(20);

    // Short-lived pixels left behind by moving projectiles.
    this.trail = scene.add.particles(0, 0, 'px', {
      lifespan: { min: 90, max: 160 },
      scale: { start: S, end: S / 2 },
      alpha: { start: 0.9, end: 0 },
      speed: { min: 0, max: 20 },
      emitting: false,
    }).setDepth(11);
  }

  hitSparks(x, y) {
    this.sparks.explode(7, x, y);
  }

  // A spray of droplets that stain the floor where they land, and a splat under the body.
  // `feetY` is where the body touches the floor; `size` scales the splat (1 for a normal enemy).
  bloodBurst(x, y, feetY, size = 1) {
    this.blood.explode(Math.round(18 * size), x, y);
    const key = `splat-${Phaser.Math.Between(0, SPLAT_VARIANTS - 1)}`;
    this.stains.stamp(key, undefined, x / S, feetY / S, { scale: size, rotation: Phaser.Math.Between(0, 1) * Math.PI });
  }

  stain(x, y, pixels, tint) {
    this.stains.stamp('px', undefined, Math.round(x / S), Math.round(y / S), { scale: pixels, tint, originX: 0, originY: 0 });
  }

  projectileTrail(x, y, tint) {
    this.trail.particleTint = tint;
    this.trail.emitParticleAt(x, y, 1);
  }

  shake({ duration, intensity }) {
    this.scene.cameras.main.shake(duration, intensity, true);
  }

  flash(sprite, ms = 70) {
    sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(ms, () => {
      if (sprite.active && !sprite.dying) sprite.clearTint();
    });
  }

  // Scale effects are relative to sprite.baseScale (sprite-sheet art is drawn larger than 1).
  squash(sprite, amount = 0.3, ms = 90) {
    const base = sprite.baseScale ?? 1;
    this.scene.tweens.add({
      targets: sprite,
      scaleX: base * (1 + amount),
      scaleY: base * (1 - amount),
      duration: ms / 2,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  // Stretch along the dash's main axis (pixel sprites don't rotate) and kick up dust behind.
  dashStart(sprite, angle) {
    this.sparks.explode(6, sprite.x - Math.cos(angle) * 10, sprite.y - Math.sin(angle) * 10);
    const horizontal = Math.abs(Math.cos(angle)) >= Math.abs(Math.sin(angle));
    const base = sprite.baseScale ?? 1;
    sprite.setScale(base * (horizontal ? 1.4 : 0.7), base * (horizontal ? 0.7 : 1.4));
    this.scene.tweens.add({ targets: sprite, scaleX: base, scaleY: base, duration: 220, ease: 'Quad.easeOut' });
  }

  afterimage(sprite, color = 0x5ce1ff) {
    const ghost = this.scene.add.image(sprite.x, sprite.y, sprite.texture.key, sprite.frame.name)
      .setOrigin(sprite.originX, sprite.originY)
      .setRotation(sprite.rotation)
      .setFlipX(sprite.flipX)
      .setScale(sprite.scaleX, sprite.scaleY)
      .setTint(color)
      .setAlpha(0.5)
      .setDepth(sprite.depth - 0.001);
    this.scene.tweens.add({ targets: ghost, alpha: 0, duration: 180, onComplete: () => ghost.destroy() });
  }

  // Expanding ring around `owner`, used to signal the dash is back.
  readyRing(owner, radius) {
    const g = this.scene.add.graphics().setDepth(9);
    const state = { t: 0 };
    const draw = () => {
      const r = radius * (1 + 0.9 * state.t);
      g.clear().fillStyle(0x5ce1ff, 1 - state.t);
      pixelSector(g, owner.x, owner.y, r - S, r);
    };
    draw();
    this.scene.tweens.add({
      targets: state,
      t: 1,
      duration: 260,
      ease: 'Quad.easeOut',
      onUpdate: draw,
      onComplete: () => g.destroy(),
    });
  }

  // A crescent that sweeps across the swing arc (direction from swing.sweep), follows `owner`, then fades.
  slash(owner, angle, { range, arcDeg, sweep, finisher, color }) {
    const half = Phaser.Math.DegToRad(arcDeg) / 2;
    const from = angle - half * sweep;
    const span = half * 2 * sweep;
    const inner = range * (finisher ? 0.35 : 0.5);
    color ??= finisher ? 0xbff3ff : 0xffffff;
    const g = this.scene.add.graphics().setDepth(15);
    const state = { t: 0 };

    const draw = () => {
      // First 40% of the time the arc sweeps out, the rest it fades.
      const grow = Math.min(state.t / 0.4, 1);
      const fade = state.t < 0.4 ? 1 : 1 - (state.t - 0.4) / 0.6;
      const swept = span * Phaser.Math.Easing.Cubic.Out(grow);
      g.clear();
      // A faint body with a bright rim along the outside of the arc.
      const rim = range - 2 * S;
      g.fillStyle(color, 0.45 * fade);
      pixelSector(g, owner.x, owner.y, inner, rim, from, swept);
      g.fillStyle(color, fade);
      pixelSector(g, owner.x, owner.y, rim, range, from, swept);
    };

    draw();
    this.scene.tweens.add({
      targets: state,
      t: 1,
      duration: finisher ? 220 : 160,
      onUpdate: draw,
      onComplete: () => g.destroy(),
    });
  }
}
