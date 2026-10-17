import Phaser from 'phaser';
import { TUNING } from '../tuning.js';

const S = TUNING.spawn;
// ?enemy=<type> in the URL spawns only that type, for testing.
const FORCED_TYPE = new URLSearchParams(location.search).get('enemy');

// Spawns enemies just outside what the players can see, faster as time goes on.
const PICK_TRIES = 8; // tries for a point no screen shows, before settling for one that one might
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
    this.spawn(p.x, p.y, this.pickType());
  }

  pickType() {
    if (FORCED_TYPE && TUNING.enemies[FORCED_TYPE]) return FORCED_TYPE;
    const elapsed = (this.scene.time.now - this.startedAt) / 1000;
    const stage = S.stages.findLast((s) => elapsed >= s.at);
    const alive = {};
    for (const e of this.scene.enemies.getChildren()) alive[e.type] = (alive[e.type] ?? 0) + 1;
    const options = Object.entries(stage.weights).filter(([type]) => (alive[type] ?? 0) < (S.maxAliveByType[type] ?? Infinity));
    const total = options.reduce((sum, [, w]) => sum + w, 0);
    let roll = Math.random() * total;
    for (const [type, w] of options) {
      roll -= w;
      if (roll <= 0) return type;
    }
    return 'grunt';
  }

  // A random point just off one of the players' screens, and if possible off all of them.
  pickPoint() {
    const views = this.scene.views();
    let p;
    for (let i = 0; i < PICK_TRIES; i++) {
      p = this.pointOutside(Phaser.Utils.Array.GetRandom(views));
      if (!views.some((v) => v.contains(p.x, p.y))) break;
    }
    return p;
  }

  // Random point on the perimeter of `view` grown by a margin, clamped into the world.
  pointOutside(view) {
    const m = S.offscreenMargin;
    const rect = new Phaser.Geom.Rectangle(view.x - m, view.y - m, view.width + m * 2, view.height + m * 2);
    const p = rect.getRandomPoint();
    switch (Phaser.Math.Between(0, 3)) {
      case 0: p.y = rect.top; break;
      case 1: p.y = rect.bottom; break;
      case 2: p.x = rect.left; break;
      default: p.x = rect.right;
    }
    const r = Math.max(...Object.values(TUNING.enemies).map((e) => e.radius));
    p.x = Phaser.Math.Clamp(p.x, r, TUNING.world.width - r);
    p.y = Phaser.Math.Clamp(p.y, r, TUNING.world.height - r);
    return p;
  }
}
