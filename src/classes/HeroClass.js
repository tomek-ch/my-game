import { TUNING } from '../tuning.js';
import { sfx } from '../audio/sfx.js';

// A playable class: what one player's buttons do. The Player owns the body (movement, health, the dash
// physics) and the scene owns the shared combat (hitting enemies, hitstop, bullets); a class decides
// when to dash, attack and so on. One instance per player, created with it and kept as `player.kit`.
//
// Subclasses set these statics:
//   id        key in TUNING.classes and in the class picker
//   title     shown on the start screen
//   heroes    character art per player slot, e.g. ['knight_m', 'knight_f']
//   weapon    { frame, originY }, see Player
//   hud       which resource widget the HUD draws under the hearts (see Hud.js)
//   controls  [{ action, kbm, pad }] rows for the start screen
export class HeroClass {
  constructor(scene, player) {
    this.scene = scene;
    this.player = player;
    this.cfg = TUNING.classes[this.constructor.id];
    this.dashWasReady = true;
    this.nextGhostAt = 0;
  }

  get playerIndex() {
    return this.scene.players.indexOf(this.player);
  }

  // Once a frame while the player is alive and not in hitstop, after the controls are read. Must call
  // player.move().
  update(_now, _dt) {}

  // After physics each frame, with the player's own visuals, for anything drawn relative to the player.
  syncVisuals(_now) {}

  // The number the HUD's resource widget shows.
  get hudValue() {
    return 0;
  }

  // Afterimages while dashing, and a ring and a chime when the dash is back.
  dashFx(now, ghostIntervalMs, color) {
    const p = this.player;
    if (p.isDashing && now >= this.nextGhostAt) {
      this.scene.fx.afterimage(p, color);
      this.nextGhostAt = now + ghostIntervalMs;
    }
    const ready = !p.isDashing && now >= p.nextDashAt;
    if (ready && !this.dashWasReady) {
      this.scene.fx.readyRing(p, TUNING.player.radius);
      sfx.dashReady(p);
    }
    this.dashWasReady = ready;
  }
}
