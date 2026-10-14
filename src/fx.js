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

  // A crescent that follows `owner` and fades out.
  slash(owner, angle, range, arcDeg) {
    const half = Phaser.Math.DegToRad(arcDeg) / 2;
    const inner = range * 0.45;
    const g = this.scene.add.graphics().setDepth(15);
    g.fillStyle(0xffffff, 0.9);
    g.beginPath();
    g.arc(0, 0, range, angle - half, angle + half, false);
    g.arc(0, 0, inner, angle + half, angle - half, true);
    g.closePath();
    g.fillPath();
    g.setPosition(owner.x, owner.y).setScale(0.75);
    this.scene.tweens.add({
      targets: g,
      scale: 1,
      alpha: 0,
      duration: 150,
      ease: 'Cubic.easeOut',
      onUpdate: () => g.setPosition(owner.x, owner.y),
      onComplete: () => g.destroy(),
    });
  }
}
