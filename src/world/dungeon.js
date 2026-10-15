import { ART_SCALE } from '../art.js';
import { TILE, dungeonLayout } from './dungeonLayout.js';

// Bakes the static tiles into one texture and adds the animated fountains on top.
// Returns the area the art covers, in world pixels, for the camera bounds.
export function addDungeon(scene, worldWidth, worldHeight) {
  const unit = TILE * ART_SCALE;
  const layout = dungeonLayout(Math.round(worldWidth / unit), Math.round(worldHeight / unit));
  const b = layout.bounds;

  const rt = scene.add.renderTexture(b.x * ART_SCALE, b.y * ART_SCALE, b.width, b.height)
    .setOrigin(0)
    .setScale(ART_SCALE)
    .setDepth(0);
  rt.beginDraw();
  for (const t of layout.tiles) rt.batchDrawFrame('dungeon', t.frame, t.x - b.x, t.y - b.y);
  rt.endDraw();

  for (const f of layout.fountains) {
    // Start each fountain at a different point in its loop so they don't pulse in sync.
    const start = Math.floor(Math.random() * 3);
    for (const [part, dy] of [['mid', 0], ['basin', TILE]]) {
      scene.add.sprite(f.x * ART_SCALE, (f.y + dy) * ART_SCALE, 'dungeon')
        .setOrigin(0)
        .setScale(ART_SCALE)
        .setDepth(1)
        .play({ key: `fountain_${part}_${f.color}`, startFrame: start });
    }
  }

  return { x: b.x * ART_SCALE, y: b.y * ART_SCALE, width: b.width * ART_SCALE, height: b.height * ART_SCALE };
}
