// Hitstop freezes only what took part in a hit (the attacker and whatever it struck), so in co-op one
// player's hits never stall the other. A frozen sprite holds still and its animation pauses; its
// velocity is kept and picks up again when it thaws. The scene skips a frozen sprite's update, so
// counters that only advance there (an enemy's stateT, a player's step and dash) wait out the freeze.

export function freeze(sprite, until) {
  if (!sprite?.active || !sprite.body) return;
  sprite.frozenUntil = Math.max(sprite.frozenUntil ?? 0, until);
  sprite.body.moves = false;
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
