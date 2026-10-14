import { TUNING } from './tuning.js';

export const COLORS = {
  bg: 0x101018,
  gridLine: 0x1d1d2b,
  border: 0x3a3a55,
  player: 0x5ce1ff,
  playerOutline: 0xe8fbff,
  enemy: 0xff4d6d,
  enemyOutline: 0x7a1530,
};

// Generates every texture from shapes, so there are no asset files yet.
export function createTextures(scene) {
  if (scene.textures.exists('player')) return;
  const g = scene.make.graphics({}, false);

  const pr = TUNING.player.radius;
  g.fillStyle(COLORS.player).fillCircle(pr, pr, pr);
  g.lineStyle(3, COLORS.playerOutline).strokeCircle(pr, pr, pr - 1.5);
  g.generateTexture('player', pr * 2, pr * 2).clear();

  const er = TUNING.enemy.radius;
  g.fillStyle(COLORS.enemy).fillCircle(er, er, er);
  g.lineStyle(3, COLORS.enemyOutline).strokeCircle(er, er, er - 1.5);
  g.fillStyle(0xffffff).fillCircle(er + 4, er - 3, 2.5).fillCircle(er + 4, er + 3, 2.5);
  g.generateTexture('enemy', er * 2, er * 2).clear();

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
