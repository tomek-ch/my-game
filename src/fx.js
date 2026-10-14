import Phaser from 'phaser';

// Visual juice: particles, slashes, flashes, shake.
export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.sparks = scene.add.particles(0, 0, 'dot', {
      speed: { min: 140, max: 340 },
      lifespan: { min: 100, max: 240 },
      scale: { start: 0.8, end: 0 },
      emitting: false,
    }).setDepth(20);
    this.gore = scene.add.particles(0, 0, 'dot', {
      speed: { min: 60, max: 300 },
      lifespan: { min: 250, max: 550 },
      scale: { start: 1.3, end: 0 },
      tint: [0xff4d6d, 0xff8fa3, 0xffffff],
      emitting: false,
    }).setDepth(20);
  }

  hitSparks(x, y) {
    this.sparks.explode(7, x, y);
  }

  deathBurst(x, y) {
    this.gore.explode(18, x, y);
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

  squash(sprite, amount = 0.3, ms = 90) {
    this.scene.tweens.add({
      targets: sprite,
      scaleX: 1 + amount,
      scaleY: 1 - amount,
      duration: ms / 2,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  // Stretch along the dash direction and kick up dust behind.
  dashStart(sprite, angle) {
    this.sparks.explode(6, sprite.x - Math.cos(angle) * 10, sprite.y - Math.sin(angle) * 10);
    sprite.setRotation(angle).setScale(1.4, 0.7);
    this.scene.tweens.add({ targets: sprite, scaleX: 1, scaleY: 1, duration: 220, ease: 'Quad.easeOut' });
  }

  afterimage(sprite, color = 0x5ce1ff) {
    const ghost = this.scene.add.image(sprite.x, sprite.y, sprite.texture.key)
      .setRotation(sprite.rotation)
      .setScale(sprite.scaleX, sprite.scaleY)
      .setTint(color)
      .setAlpha(0.5)
      .setDepth(sprite.depth - 1);
    this.scene.tweens.add({ targets: ghost, alpha: 0, duration: 180, onComplete: () => ghost.destroy() });
  }

  // Expanding ring around `owner`, used to signal the dash is back.
  readyRing(owner, radius) {
    const g = this.scene.add.graphics().setDepth(9).setPosition(owner.x, owner.y);
    g.lineStyle(2, 0x5ce1ff).strokeCircle(0, 0, radius);
    this.scene.tweens.add({
      targets: g,
      scale: 1.9,
      alpha: 0,
      duration: 260,
      ease: 'Quad.easeOut',
      onUpdate: () => g.setPosition(owner.x, owner.y),
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
      const head = from + span * Phaser.Math.Easing.Cubic.Out(grow);
      g.clear().setPosition(owner.x, owner.y);
      g.fillStyle(color, 0.95 * fade);
      g.beginPath();
      g.arc(0, 0, range, from, head, sweep < 0);
      g.arc(0, 0, inner, head, from, sweep > 0);
      g.closePath();
      g.fillPath();
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
