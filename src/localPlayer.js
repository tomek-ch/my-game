// Online, each machine plays one player; solo or in local co-op, every player is on this one. Effects
// that belong to a player (their sounds, their screen shake) ask this whether that player is here.
export const localPlayer = { slot: null }; // the player slot played here, or null for all of them

// owner: anything with a `slot` (a Player, or the { slot, x, y } an online guest is sent), or null
// for an effect that's nobody's in particular.
export function isLocal(owner) {
  return localPlayer.slot === null || !owner || owner.slot === localPlayer.slot;
}
