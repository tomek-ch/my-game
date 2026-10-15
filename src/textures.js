export const COLORS = {
  enemyBullet: 0xd78bff,
};

export function createTextures(scene) {
  const g = scene.make.graphics({}, false);

  g.fillStyle(COLORS.enemyBullet).fillCircle(7, 7, 7);
  g.fillStyle(0xffffff).fillCircle(7, 7, 3.5);
  g.generateTexture('ebullet', 14, 14).clear();

  g.fillStyle(0xffd34d).fillRoundedRect(0, 0, 16, 6, 3);
  g.fillStyle(0xffffff).fillRoundedRect(4, 1.5, 10, 3, 1.5);
  g.generateTexture('bolt', 16, 6).clear();

  g.fillStyle(0xffffff).fillCircle(4, 4, 4);
  g.generateTexture('dot', 8, 8);

  g.destroy();
}
