// Where every background tile goes, in source-art pixels (one tile = 16px; the scene draws it all at
// ART_SCALE). Plain data with no Phaser, so the layout can also be previewed outside the game.
// The floor covers cols x rows tiles starting at (0, 0). The north wall stands above it (rows -2 and -1);
// the other walls are a rim drawn over the outermost floor tiles.

import { seededRandom } from '../random.js';

export const TILE = 16;

function pick(rng, weighted) {
  const total = weighted.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng() * total;
  for (const [value, w] of weighted) {
    roll -= w;
    if (roll <= 0) return value;
  }
  return weighted[0][0];
}

// Mostly plain stone; cracks now and then, and the big dark stains (4, 6, 7, 8) only rarely.
const FLOORS = [
  ['floor_1', 100], ['floor_5', 18], ['floor_3', 10], ['floor_2', 4],
  ['floor_4', 1], ['floor_6', 1], ['floor_7', 0.5], ['floor_8', 0.5],
];
const SKULL_CHANCE = 0.004;
const WALL_FACES = [['wall_mid', 30], ['wall_hole_1', 1], ['wall_hole_2', 1]];
const BANNERS = ['wall_banner_red', 'wall_banner_blue', 'wall_banner_green', 'wall_banner_yellow'];

// Returns { tiles: [{ frame, x, y }], fountains: [{ color, x, y }], bounds: { x, y, width, height } }.
// tiles are drawn in order; fountains are animated, so the scene adds them as sprites.
export function dungeonLayout(cols, rows, seed = 4) {
  const rng = seededRandom(seed);
  const tiles = [];
  const fountains = [];
  const put = (frame, col, row) => tiles.push({ frame, x: col * TILE, y: row * TILE });

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      put(pick(rng, FLOORS), col, row);
      if (rng() < SKULL_CHANCE) put('skull', col, row);
    }
  }

  // North wall: brick face on row -1 with its top cap above. Banners and fountains break it up.
  // The corner columns are drawn by the edge tiles below.
  let nextFeature = 4 + Math.floor(rng() * 5);
  for (let col = 1; col < cols - 1; col++) {
    let face = pick(rng, WALL_FACES);
    let cap = 'wall_top_mid';
    if (col === nextFeature && col < cols - 3) {
      if (rng() < 0.3) {
        const color = rng() < 0.5 ? 'red' : 'blue';
        fountains.push({ color, x: col * TILE, y: -TILE });
        face = null;
        cap = `wall_fountain_top_${1 + Math.floor(rng() * 3)}`;
      } else {
        face = BANNERS[Math.floor(rng() * BANNERS.length)];
      }
      nextFeature = col + 5 + Math.floor(rng() * 7);
    }
    put(cap, col, -2);
    if (face) put(face, col, -1);
  }

  // The side and bottom walls are only seen from above, as a rim drawn over the outermost floor tiles.
  put('wall_edge_top_left', 0, -2);
  put('wall_edge_top_right', cols - 1, -2);
  put('wall_edge_left', 0, -1);
  put('wall_edge_right', cols - 1, -1);
  for (let row = 0; row < rows - 1; row++) {
    put('wall_edge_mid_left', 0, row);
    put('wall_edge_mid_right', cols - 1, row);
  }
  for (let col = 1; col < cols - 1; col++) put('wall_top_mid', col, rows - 1);
  put('wall_edge_bottom_left', 0, rows - 1);
  put('wall_edge_bottom_right', cols - 1, rows - 1);

  return {
    tiles,
    fountains,
    // One empty row above the wall, so its top isn't flush with the screen edge.
    bounds: { x: 0, y: -3 * TILE, width: cols * TILE, height: (rows + 3) * TILE },
  };
}
