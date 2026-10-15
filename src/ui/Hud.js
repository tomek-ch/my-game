import Phaser from 'phaser';
import { TUNING } from '../tuning.js';
import { BLOOD } from '../textures.js';
import { pixelText } from './pixelFont.js';

const UI = 3;          // screen pixels per art pixel for HUD text and icons
const HEART_SCALE = 2; // hearts are drawn a bit smaller
const MARGIN = 16;
const DEPTH = 100;
const HEART_W = 13;    // ui_heart_* frames are 13x12 art pixels
const HEART_H = 12;
const HEART_GAP = 2;
const SKULL = { x: 5, y: 7, size: 6 }; // the visible skull inside its 16x16 frame
const GLYPH_H = 7;     // pixel font letter height
const CHARGE_SCALE = 2;
const CHARGE_GAP = 3;  // art pixels between charge slots
const CHARGE_EMPTY = 0x3a2f45;
const R = TUNING.ranged;

// Hearts (one per HP), the shot charges, a skull with the kill count, the run timer, and the
// game-over screen.
export class Hud {
  constructor(scene, maxHp) {
    this.scene = scene;
    this.shownHp = maxHp;
    this.hearts = [];
    for (let i = 0; i < maxHp; i++) {
      const x = MARGIN + (i * (HEART_W + HEART_GAP) + HEART_W / 2) * HEART_SCALE;
      const heart = scene.add.image(x, MARGIN + HEART_H / 2 * HEART_SCALE, 'dungeon', 'ui_heart_full');
      this.hearts.push(this.fixed(heart.setScale(HEART_SCALE)));
    }

    // One bolt per storable shot: a dark silhouette, with the bolt filling in from the tail as
    // sword hits add pips.
    const boltW = scene.textures.getFrame('bolt').width;
    const boltH = scene.textures.getFrame('bolt').height;
    const chargeTop = MARGIN + HEART_H * HEART_SCALE + 8;
    const chargeY = chargeTop + boltH * CHARGE_SCALE / 2;
    this.charges = [];
    for (let i = 0; i < R.maxCharges; i++) {
      const x = MARGIN + (i * (boltW + CHARGE_GAP) + boltW / 2) * CHARGE_SCALE;
      const empty = this.fixed(scene.add.image(x, chargeY, 'bolt').setScale(CHARGE_SCALE).setTintFill(CHARGE_EMPTY));
      const fill = this.fixed(scene.add.image(x, chargeY, 'bolt').setScale(CHARGE_SCALE));
      this.charges.push({ x, empty, fill, full: false });
    }

    // Skull placed by its visible pixels, with the count centered on it.
    const rowTop = chargeTop + boltH * CHARGE_SCALE + 12;
    this.fixed(scene.add.image(MARGIN, rowTop, 'dungeon', 'skull')
      .setOrigin(SKULL.x / 16, SKULL.y / 16)
      .setScale(UI));
    const textTop = rowTop + (SKULL.size - GLYPH_H) * UI / 2;
    this.kills = this.fixed(pixelText(scene, MARGIN + (SKULL.size + 3) * UI, textTop, '0', UI));

    const right = scene.cameras.main.width - MARGIN;
    this.timer = this.fixed(pixelText(scene, right, MARGIN, '0:00', UI).setOrigin(1, 0));
    this.muted = this.fixed(pixelText(scene, right, MARGIN + 30, '[M] muted', 2).setOrigin(1, 0).setAlpha(0.7));
  }

  fixed(obj) {
    return obj.setScrollFactor(0).setDepth(DEPTH);
  }

  update(now, { hp, pips, kills, secs, muted }) {
    hp = Math.max(hp, 0);
    for (let i = hp; i < this.shownHp; i++) this.loseHeart(this.hearts[i]);
    this.shownHp = Math.min(this.shownHp, hp);

    // The last heart beats.
    const last = this.hearts[0];
    if (hp === 1 && !last.popping) last.setScale(HEART_SCALE * (1 + 0.12 * Math.max(0, Math.sin(now / 110))));

    this.updateCharges(pips);
    this.kills.setText(String(kills));
    this.timer.setText(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`);
    this.muted.setVisible(muted);
  }

  updateCharges(pips) {
    this.charges.forEach((slot, i) => {
      const frac = Phaser.Math.Clamp((pips - i * R.pipsPerCharge) / R.pipsPerCharge, 0, 1);
      const { width, height } = slot.fill.frame;
      slot.fill.setCrop(0, 0, Math.round(width * frac), height).setAlpha(frac < 1 ? 0.45 : 1);
      const full = frac === 1;
      if (full && !slot.full) {
        slot.fill.setScale(CHARGE_SCALE * 1.5);
        this.scene.tweens.add({ targets: slot.fill, scale: CHARGE_SCALE, duration: 220, ease: 'Back.easeOut' });
      }
      slot.full = full;
    });
  }

  // Rattle the charge slots when you try to shoot with none.
  shakeCharges() {
    for (const slot of this.charges) {
      const targets = [slot.empty, slot.fill];
      this.scene.tweens.killTweensOf(targets);
      for (const t of targets) t.setX(slot.x).setScale(CHARGE_SCALE); // also ends a fill pop cut short
      slot.empty.setTintFill(BLOOD[3]);
      this.scene.tweens.add({
        targets,
        x: slot.x + 4,
        duration: 35,
        yoyo: true,
        repeat: 2,
        onComplete: () => slot.empty.setTintFill(CHARGE_EMPTY),
      });
    }
  }

  loseHeart(heart) {
    heart.setFrame('ui_heart_empty').setTintFill(0xffffff).setScale(HEART_SCALE * 1.6);
    heart.popping = true;
    this.scene.tweens.add({
      targets: heart,
      scale: HEART_SCALE,
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
