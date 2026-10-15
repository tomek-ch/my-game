// Sprite-sheet art. Everything comes from 0x72's Dungeon Tileset II (see CREDITS.md), drawn at
// ART_SCALE screen pixels per art pixel.

export const ART_SCALE = 2;

export function preloadArt(scene) {
  scene.load.image('dungeon', 'assets/dungeon/sheet.png');
  scene.load.text('dungeon-frames', 'assets/dungeon/frames.txt');
}

// The pack lists its frames as "name x y w h" lines; turn them into named frames on the sheet.
export function registerArt(scene) {
  const texture = scene.textures.get('dungeon');
  for (const line of scene.cache.text.get('dungeon-frames').split('\n')) {
    const [name, ...rect] = line.trim().split(/\s+/);
    if (rect.length === 4) texture.add(name, 0, ...rect.map(Number));
  }

  loopAnim(scene, 'knight_idle', 'knight_m_idle_anim_f', 4, 6);
  loopAnim(scene, 'knight_run', 'knight_m_run_anim_f', 4, 12);

  for (const color of ['red', 'blue']) {
    loopAnim(scene, `fountain_mid_${color}`, `wall_fountain_mid_${color}_anim_f`, 3, 6);
    loopAnim(scene, `fountain_basin_${color}`, `wall_fountain_basin_${color}_anim_f`, 3, 6);
  }
}

// A looping animation over frames named <prefix>0 .. <prefix>(count - 1).
function loopAnim(scene, key, prefix, count, frameRate) {
  scene.anims.create({
    key,
    frames: scene.anims.generateFrameNames('dungeon', { prefix, start: 0, end: count - 1 }),
    frameRate,
    repeat: -1,
  });
}
