import Phaser from 'phaser';
import { TUNING } from './tuning.js';

const C = TUNING.camera;

// What a camera follows: a weighted middle of the players. Each player's weight eases between 0 and 1
// as they start or stop being watched, so a change, like a player dying, pans over instead of lurching.
export class CameraFocus {
  constructor() {
    this.point = new Phaser.Math.Vector2();
    this.weights = null; // per player, 0..1; set on the first update
  }

  // players: [{ x, y }]. watched: whether each one is watched now (see watchedPlayers). dt in seconds.
  update(players, watched, dt) {
    if (!watched.some(Boolean)) return; // nobody left to watch: stay where we are
    const step = (dt * 1000) / C.focusFadeMs;
    this.weights = this.weights
      ? this.weights.map((w, i) => Phaser.Math.Clamp(w + (watched[i] ? step : -step), 0, 1))
      : watched.map((on) => (on ? 1 : 0));
    let total = 0;
    let x = 0;
    let y = 0;
    players.forEach((p, i) => {
      const w = Phaser.Math.SmoothStep(this.weights[i], 0, 1);
      x += p.x * w;
      y += p.y * w;
      total += w;
    });
    if (total > 0) this.point.set(x / total, y / total);
  }
}

// Which players a camera watches. A shared screen watches everyone alive. A screen of its own (online,
// ownIndex being that machine's player) watches its player, and the others once it's dead.
export function watchedPlayers(alive, ownIndex = null) {
  if (ownIndex !== null && alive[ownIndex]) return alive.map((_, i) => i === ownIndex);
  return alive;
}

// Leans the camera toward the mouse (pointer, or null to settle back), easing `lookahead` (a Vector2
// kept between frames) toward the lean.
export function leanCamera(cam, lookahead, pointer) {
  const tx = pointer ? -(pointer.x - cam.width / 2) * C.aimLookahead : 0;
  const ty = pointer ? -(pointer.y - cam.height / 2) * C.aimLookahead : 0;
  lookahead.x += (tx - lookahead.x) * C.lookaheadLerp;
  lookahead.y += (ty - lookahead.y) * C.lookaheadLerp;
  cam.setFollowOffset(lookahead.x, lookahead.y);
}
