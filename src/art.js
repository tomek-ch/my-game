// Sprite-sheet art. Everything comes from 0x72's Dungeon Tileset II (see CREDITS.md), drawn at
// ART_SCALE screen pixels per art pixel.

export const ART_SCALE = 2;

// The monster drawn for each enemy type, the center of its hit circle in the frame (art pixels,
// placed so the circle's bottom touches the feet), and its shadow width (art pixels). The scene keeps
// using the enemy's position as that center, so gameplay doesn't depend on the art.
export const ENEMY_ART = {
  grunt: { monster: 'goblin', center: { x: 8, y: 9.5 }, shadow: 10 },
  charger: { monster: 'chort', center: { x: 8, y: 17 }, shadow: 12 },
  shooter: { monster: 'necromancer', center: { x: 7, y: 17 }, shadow: 12 },
  brute: { monster: 'big_demon', center: { x: 16, y: 24 }, shadow: 24 },
};

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

  // Every playable class's heroes (see src/classes/).
  for (const hero of ['knight_m', 'knight_f', 'lizard_m', 'lizard_f']) {
    loopAnim(scene, `${hero}_idle`, `${hero}_idle_anim_f`, 4, 6);
    loopAnim(scene, `${hero}_run`, `${hero}_run_anim_f`, 4, 12);
  }

  // <monster>_idle and <monster>_run; monsters with a single loop use it for both.
  for (const { monster } of Object.values(ENEMY_ART)) {
    const single = !texture.has(`${monster}_idle_anim_f0`);
    loopAnim(scene, `${monster}_idle`, single ? `${monster}_anim_f` : `${monster}_idle_anim_f`, 4, 6);
    loopAnim(scene, `${monster}_run`, single ? `${monster}_anim_f` : `${monster}_run_anim_f`, 4, 10);
  }

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
