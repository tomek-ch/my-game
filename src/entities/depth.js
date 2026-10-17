import { TUNING } from '../tuning.js';

// Characters share one depth band and sort by y, so whoever is lower on screen draws in front.
// Telegraphs sit just below the band (4) and projectiles just above it (12).
export const CHARACTER_DEPTH = 5;
// Anything in the air draws above every character, still below projectiles.
export const AIR_DEPTH = 11;

export function ySortDepth(y) {
  return CHARACTER_DEPTH + y / TUNING.world.height;
}
