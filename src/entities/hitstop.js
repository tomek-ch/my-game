// Hitstop freezes only what took part in a hit (the attacker and whatever it struck), so in co-op one
// player's hits never stall the other. A frozen sprite holds still and its animation pauses; its
// velocity is kept and picks up again when it thaws. The scene skips a frozen sprite's update, so
// counters that only advance there (an enemy's stateT, a player's step and dash) wait out the freeze.

export function freeze(sprite, until) {
  if (!sprite?.active || !sprite.body) return;
  sprite.frozenUntil = Math.max(sprite.frozenUntil ?? 0, until);
  const body = sprite.body;
  if (body.moves) {
    // Arcade copies a step onto the sprite after update(), but not with moves off: the body would snap
    // back to the sprite, and every hit cost a frame of travel. So bring the sprite to the body now
    // (the inverse of Body.updateFromGameObject; nothing to do when no step is pending).
    sprite.x = body.position.x - sprite.scaleX * (body.offset.x - sprite.displayOriginX);
    sprite.y = body.position.y - sprite.scaleY * (body.offset.y - sprite.displayOriginY);
  }
  body.moves = false;
  sprite.anims?.pause();
}

export function isFrozen(sprite, now) {
  return now < (sprite.frozenUntil ?? 0);
}

export function thaw(sprite) {
  sprite.body.moves = true;
  // A sprite that died while frozen keeps its death pose.
  if (!sprite.dead && !sprite.dying) sprite.anims?.resume();
}
