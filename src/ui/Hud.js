import { BLOOD } from '../textures.js';
import { pixelText } from './pixelFont.js';

const UI = 3;          // screen pixels per art pixel for HUD art and text
const MARGIN = 16;
const DEPTH = 100;
const HEART_W = 13;    // ui_heart_* frames are 13x12 art pixels
const HEART_H = 12;
const HEART_GAP = 2;

// Hearts (one per HP), a skull with the kill count, the run timer, and the game-over screen.
export class Hud {
  constructor(scene, maxHp) {
    this.scene = scene;
    this.shownHp = maxHp;
    this.hearts = [];
    for (let i = 0; i < maxHp; i++) {
      const x = MARGIN + (i * (HEART_W + HEART_GAP) + HEART_W / 2) * UI;
      this.hearts.push(this.fixed(scene.add.image(x, MARGIN + HEART_H / 2 * UI, 'dungeon', 'ui_heart_full').setScale(UI)));
    }

    const rowY = MARGIN + HEART_H * UI + 22;
    this.fixed(scene.add.image(MARGIN + 6 * UI, rowY, 'dungeon', 'skull').setScale(UI));
    this.kills = this.fixed(pixelText(scene, MARGIN + 14 * UI, rowY, '0', UI).setOrigin(0, 0.5));

    const right = scene.cameras.main.width - MARGIN;
    this.timer = this.fixed(pixelText(scene, right, MARGIN, '0:00', UI).setOrigin(1, 0));
    this.muted = this.fixed(pixelText(scene, right, MARGIN + 30, '[M] muted', 2).setOrigin(1, 0).setAlpha(0.7));
  }

  fixed(obj) {
    return obj.setScrollFactor(0).setDepth(DEPTH);
  }

  update(now, { hp, kills, secs, muted }) {
    hp = Math.max(hp, 0);
    for (let i = hp; i < this.shownHp; i++) this.loseHeart(this.hearts[i]);
    this.shownHp = Math.min(this.shownHp, hp);

    // The last heart beats.
    const last = this.hearts[0];
    if (hp === 1 && !last.popping) last.setScale(UI * (1 + 0.12 * Math.max(0, Math.sin(now / 110))));

    this.kills.setText(String(kills));
    this.timer.setText(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`);
    this.muted.setVisible(muted);
  }

  loseHeart(heart) {
    heart.setFrame('ui_heart_empty').setTintFill(0xffffff).setScale(UI * 1.6);
    heart.popping = true;
    this.scene.tweens.add({
      targets: heart,
      scale: UI,
      duration: 260,
      ease: 'Back.easeOut',
      onComplete: () => {
        heart.popping = false;
        heart.clearTint();
      },
    });
    this.scene.time.delayedCall(90, () => heart.clearTint());
  }

  showGameOver({ kills, secs }) {
    const scene = this.scene;
    const { width, height } = scene.cameras.main;
    const shade = scene.add.rectangle(0, 0, width, height, 0x0b0710, 0.6)
      .setOrigin(0).setScrollFactor(0).setDepth(DEPTH - 1).setAlpha(0);
    scene.tweens.add({ targets: shade, alpha: 1, duration: 400 });

    const title = pixelText(scene, width / 2, height / 2 - 70, 'You died', 14)
      .setOrigin(0.5).setDepth(DEPTH).setTint(BLOOD[3]);
    scene.tweens.add({ targets: title, scale: 10, duration: 300, ease: 'Back.easeOut' });

    const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    pixelText(scene, width / 2, height / 2 + 20, `${kills} kills  -  ${time}`, UI).setOrigin(0.5).setDepth(DEPTH);
    const hint = pixelText(scene, width / 2, height / 2 + 80, 'Click or press R to restart', 2)
      .setOrigin(0.5).setDepth(DEPTH);
    scene.tweens.add({ targets: hint, alpha: 0.3, duration: 600, yoyo: true, repeat: -1 });
  }
}
