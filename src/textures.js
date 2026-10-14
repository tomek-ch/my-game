import { TUNING } from './tuning.js';

export const COLORS = {
  bg: 0x101018,
  gridLine: 0x1d1d2b,
  border: 0x3a3a55,
  player: 0x5ce1ff,
  playerOutline: 0xe8fbff,
  enemyBullet: 0xd78bff,
};

// Enemy textures have this much space around the body circle for spikes and barrels.
export const ENEMY_PAD = 6;

// Generates every texture from shapes, so there are no asset files yet.
export function createTextures(scene) {
  if (scene.textures.exists('player')) return;
  const g = scene.make.graphics({}, false);

  const pr = TUNING.player.radius;
  g.fillStyle(COLORS.player).fillCircle(pr, pr, pr);
  g.lineStyle(3, COLORS.playerOutline).strokeCircle(pr, pr, pr - 1.5);
  g.generateTexture('player', pr * 2, pr * 2).clear();

  // Enemies face +x; extras are drawn in front of the body.
  for (const [type, cfg] of Object.entries(TUNING.enemies)) {
    const r = cfg.radius;
    const c = r + ENEMY_PAD;
    if (type === 'charger') {
      g.fillStyle(cfg.outline).fillTriangle(c + r - 4, c - 6, c + r + ENEMY_PAD, c, c + r - 4, c + 6);
    } else if (type === 'shooter') {
      g.fillStyle(cfg.outline).fillRect(c + r - 4, c - 3, ENEMY_PAD + 4, 6);
    }
    g.fillStyle(cfg.color).fillCircle(c, c, r);
    const thick = type === 'brute' ? 5 : 3;
    g.lineStyle(thick, cfg.outline).strokeCircle(c, c, r - thick / 2);
    const eye = type === 'brute' ? 4 : 2.5;
    const eyeX = c + r * 0.35;
    const eyeY = r * 0.25;
    if (type === 'shooter') g.fillStyle(0xffffff).fillCircle(eyeX, c, eye + 1);
    else g.fillStyle(0xffffff).fillCircle(eyeX, c - eyeY, eye).fillCircle(eyeX, c + eyeY, eye);
    g.generateTexture(`enemy-${type}`, c * 2, c * 2).clear();
  }

  g.fillStyle(COLORS.enemyBullet).fillCircle(7, 7, 7);
  g.fillStyle(0xffffff).fillCircle(7, 7, 3.5);
  g.generateTexture('ebullet', 14, 14).clear();

  g.fillStyle(0xffffff).fillTriangle(0, 0, 10, 5, 0, 10);
  g.generateTexture('aim', 10, 10).clear();

  g.fillStyle(0xffd34d).fillRoundedRect(0, 0, 16, 6, 3);
  g.fillStyle(0xffffff).fillRoundedRect(4, 1.5, 10, 3, 1.5);
  g.generateTexture('bolt', 16, 6).clear();

  g.fillStyle(0xffffff).fillCircle(4, 4, 4);
  g.generateTexture('dot', 8, 8).clear();

  g.fillStyle(COLORS.bg).fillRect(0, 0, 64, 64);
  g.lineStyle(1, COLORS.gridLine).lineBetween(0, 0.5, 64, 0.5).lineBetween(0.5, 0, 0.5, 64);
  g.generateTexture('grid', 64, 64);

  g.destroy();
}
