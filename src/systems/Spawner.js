import Phaser from 'phaser';
import { TUNING } from '../tuning.js';

const S = TUNING.spawn;

// Spawns enemies just outside the camera view, faster as time goes on.
export class Spawner {
  constructor(scene, spawn) {
    this.scene = scene;
    this.spawn = spawn;
    this.startedAt = scene.time.now;
    this.stopped = false;
    this.schedule();
  }

  stop() {
    this.stopped = true;
  }

  interval() {
    const t = Phaser.Math.Clamp((this.scene.time.now - this.startedAt) / 1000 / S.rampSeconds, 0, 1);
    return Phaser.Math.Linear(S.startIntervalMs, S.minIntervalMs, t);
  }

  schedule() {
    this.scene.time.delayedCall(this.interval(), () => {
      if (this.stopped) return;
      this.trySpawn();
      this.schedule();
    });
  }

  trySpawn() {
    if (this.scene.enemies.countActive() >= S.maxAlive) return;
    const p = this.pickPoint();
    this.spawn(p.x, p.y);
  }

  // Random point on the perimeter of the camera view grown by a margin, clamped into the world.
  pickPoint() {
    const view = this.scene.cameras.main.worldView;
    const m = S.offscreenMargin;
    const rect = new Phaser.Geom.Rectangle(view.x - m, view.y - m, view.width + m * 2, view.height + m * 2);
    const p = rect.getRandomPoint();
    switch (Phaser.Math.Between(0, 3)) {
      case 0: p.y = rect.top; break;
      case 1: p.y = rect.bottom; break;
      case 2: p.x = rect.left; break;
      default: p.x = rect.right;
    }
    const r = TUNING.enemy.radius;
    p.x = Phaser.Math.Clamp(p.x, r, TUNING.world.width - r);
    p.y = Phaser.Math.Clamp(p.y, r, TUNING.world.height - r);
    return p;
  }
}
