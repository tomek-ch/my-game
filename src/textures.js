import { seededRandom } from './random.js';

// Small pixel-art textures made in code: projectiles, particles, shadows and blood splats.
// All are drawn at art resolution (1 texel = 1 art pixel) and shown at ART_SCALE like the sprites.

export const BLOOD = [0x5e0a12, 0x8a0f1a, 0xb3162a, 0xd8233a];
export const SPLAT_VARIANTS = 3;

// One character per pixel; '.' is transparent. The bolt points +x.
const BOLT = [
  '.....OOO......',
  '...OOYYYYW....',
  '.OOYYYWWWWWY..',
  'OYYYWWWWWWWWW.',
  'OYYWWWWWWWWWWW',
  'OYYYWWWWWWWWW.',
  '.OOYYYWWWWWY..',
  '...OOYYYYW....',
  '.....OOO......',
];
export const BOLT_TINT = 0xffd34d;
const BOLT_PALETTE = { O: 0xe08a1e, Y: BOLT_TINT, W: 0xffffff };

const ORB = [
  [
    '..PPP..',
    '.PLLLP.',
    'PLLWLLP',
    'PLWWWLP',
    'PLLWLLP',
    '.PLLLP.',
    '..PPP..',
  ],
  [
    '..PPP..',
    '.PLWLP.',
    'PLWWWLP',
    'PWWWWWP',
    'PLWWWLP',
    '.PLWLP.',
    '..PPP..',
  ],
];
const ORB_PALETTE = { P: 0xb15cff, L: 0xd78bff, W: 0xffffff };

// The mage's spells, and the burning enemies they leave behind.
export const FIRE_TINT = 0xff7a2e;
export const ZAP_TINT = 0x7fe9ff;
const ZAP_GLOW = 0x3f8cff;
const ZAP_W = 12; // art pixels; the zap points +x
const ZAP_H = 7;
const ZAP_FRAMES = 3;
const FIREBALL = [
  [
    '...RRRRR...',
    '..RFFFFFR..',
    '.RFFYYYFFR.',
    'RFFYYWYYFFR',
    'RFYYWWWYYFR',
    'RFYWWWWWYFR',
    'RFYYWWWYYFR',
    'RFFYYWYYFFR',
    '.RFFYYYFFR.',
    '..RFFFFFR..',
    '...RRRRR...',
  ],
  [
    '...RRRR....',
    '..RFFFFRR..',
    '.RFFYYYFFR.',
    'RFFYYYYYFFR',
    'RFYYWWWYYFR',
    'RFYYWWWYYFR',
    'RFYYWWWYYFR',
    'RFFYYYYYFFR',
    '.RFFYYYFFR.',
    '..RRFFFFR..',
    '....RRRR...',
  ],
];
const FIREBALL_PALETTE = { R: 0xc4361b, F: FIRE_TINT, Y: 0xffd34d, W: 0xffffff };

export function createTextures(scene) {
  const g = scene.make.graphics({}, false);

  drawRows(g, BOLT, BOLT_PALETTE).generateTexture('bolt', BOLT[0].length, BOLT.length);
  g.clear();
  ORB.forEach((rows, i) => {
    drawRows(g, rows, ORB_PALETTE).generateTexture(`orb-${i}`, rows[0].length, rows.length);
    g.clear();
  });
  scene.anims.create({
    key: 'orb',
    frames: ORB.map((_, i) => ({ key: `orb-${i}` })),
    frameRate: 8,
    repeat: -1,
  });
  FIREBALL.forEach((rows, i) => {
    drawRows(g, rows, FIREBALL_PALETTE).generateTexture(`fireball-${i}`, rows[0].length, rows.length);
    g.clear();
  });
  for (let i = 0; i < ZAP_FRAMES; i++) {
    drawZap(g, seededRandom(100 + i)).generateTexture(`zap-${i}`, ZAP_W, ZAP_H);
    g.clear();
  }
  scene.anims.create({
    key: 'zap',
    frames: Array.from({ length: ZAP_FRAMES }, (_, i) => ({ key: `zap-${i}` })),
    frameRate: 30,
    repeat: -1,
  });
  scene.anims.create({
    key: 'fireball',
    frames: FIREBALL.map((_, i) => ({ key: `fireball-${i}` })),
    frameRate: 12,
    repeat: -1,
  });

  // A single art pixel, for particles.
  g.fillStyle(0xffffff).fillRect(0, 0, 1, 1).generateTexture('px', 1, 1);
  g.clear();

  for (let i = 0; i < SPLAT_VARIANTS; i++) {
    drawSplat(g, seededRandom(i + 1)).generateTexture(`splat-${i}`, SPLAT_W, SPLAT_H);
    g.clear();
  }

  g.destroy();
}

// An oval shadow `width` art pixels wide, made the first time each width is asked for.
export function shadowTexture(scene, width) {
  const key = `shadow-${width}`;
  if (scene.textures.exists(key)) return key;
  const height = Math.max(3, Math.round(width / 3));
  const g = scene.make.graphics({}, false);
  g.fillStyle(0x000000);
  for (let y = 0; y < height; y++) {
    const ny = (y + 0.5) / height * 2 - 1;
    const half = Math.round(width / 2 * Math.sqrt(1 - ny * ny));
    g.fillRect(Math.round(width / 2) - half, y, half * 2, 1);
  }
  g.generateTexture(key, width, height).destroy();
  return key;
}

function drawRows(g, rows, palette) {
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (palette[ch] !== undefined) g.fillStyle(palette[ch]).fillRect(x, y, 1, 1);
    });
  });
  return g;
}

// A short jagged spark: a white core zigzagging along the middle row, with glow above and below it,
// brighter toward the tip.
function drawZap(g, rng) {
  const mid = (ZAP_H - 1) / 2;
  const knots = [0, 3, 6, 9, ZAP_W - 1].map((x, i, all) => ({
    x,
    y: i === all.length - 1 ? mid : Math.round(mid + (rng() - 0.5) * 4),
  }));
  const core = [];
  for (let k = 0; k < knots.length - 1; k++) {
    const a = knots[k];
    const b = knots[k + 1];
    for (let x = a.x; x < b.x || (k === knots.length - 2 && x === b.x); x++) {
      const y0 = Math.round(a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x));
      const y1 = Math.round(a.y + (b.y - a.y) * (x + 1 - a.x) / (b.x - a.x));
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) core.push({ x, y });
    }
  }
  for (const { x, y } of core) {
    g.fillStyle(x < ZAP_W / 2 ? ZAP_GLOW : ZAP_TINT).fillRect(x, y - 1, 1, 3);
  }
  g.fillStyle(0xffffff);
  for (const { x, y } of core) g.fillRect(x, y, 1, 1);
  return g;
}

// A flattened blob of blood: a few overlapping discs, with some brighter wet pixels.
const SPLAT_W = 18;
const SPLAT_H = 11;

function drawSplat(g, rng) {
  const blobs = [];
  for (let i = 0; i < 5; i++) {
    blobs.push({
      x: SPLAT_W / 2 + (rng() - 0.5) * 8,
      y: SPLAT_H / 2 + (rng() - 0.5) * 4,
      r: 1.5 + rng() * 2.5,
    });
  }
  for (let y = 0; y < SPLAT_H; y++) {
    for (let x = 0; x < SPLAT_W; x++) {
      // Squashed vertically so the splat lies flat on the floor.
      const hit = blobs.some((b) => (x + 0.5 - b.x) ** 2 + ((y + 0.5 - b.y) * 1.6) ** 2 <= b.r * b.r);
      if (hit) g.fillStyle(rng() < 0.15 ? BLOOD[2] : BLOOD[1]).fillRect(x, y, 1, 1);
    }
  }
  return g;
}
