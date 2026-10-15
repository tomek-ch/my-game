import Phaser from 'phaser';
import { TUNING } from '../tuning.js';
import { addDungeon } from '../world/dungeon.js';
import { pixelText } from '../ui/pixelFont.js';
import { BLOOD } from '../textures.js';

const UI = 3; // screen pixels per font pixel for the control rows
const KEY_COLOR = 0xf2c14e;
const CONTROLS = [
  ['WSAD', 'Move'],
  ['Space', 'Dash'],
  ['Left click', 'Melee'],
  ['Right click', 'Shot - sword hits charge it'],
];

// The title screen: the controls over a dimmed dungeon. Any click or key starts a solo run; 2 starts
// local co-op, with player 2 on a gamepad or the arrow keys.
export class StartScene extends Phaser.Scene {
  constructor() {
    super('start');
  }

  create() {
    const { width, height } = this.cameras.main;
    const { width: W, height: H } = TUNING.world;
    addDungeon(this, W, H);
    this.cameras.main.centerOn(W / 2, H / 2);
    this.add.rectangle(0, 0, width, height, 0x0b0710, 0.75).setOrigin(0).setScrollFactor(0);

    const cx = width / 2;
    this.add.sprite(cx, 150, 'dungeon', 'knight_m_idle_anim_f0')
      .setScale(5).setScrollFactor(0).play('knight_m_idle');

    pixelText(this, cx, 260, 'Controls', 5).setOrigin(0.5).setTint(BLOOD[3]);

    // Keys right-aligned and actions left-aligned around the center line.
    CONTROLS.forEach(([key, action], i) => {
      const y = 320 + i * 42;
      pixelText(this, cx - 20, y, key, UI).setOrigin(1, 0).setTint(KEY_COLOR);
      pixelText(this, cx + 20, y, action, UI);
    });

    const hint = pixelText(this, cx, height - 110, 'Click or press any key to start', 2).setOrigin(0.5);
    this.tweens.add({ targets: hint, alpha: 0.3, duration: 600, yoyo: true, repeat: -1 });
    pixelText(this, cx, height - 80, 'Press 2 for co-op: P2 uses a gamepad or arrows , . /', 2)
      .setOrigin(0.5).setAlpha(0.6);

    this.input.mouse.disableContextMenu();
    let started = false; // a click and a key press can land in the same frame
    const start = (players) => {
      if (!started) this.scene.start('game', { players });
      started = true;
    };
    this.input.once('pointerdown', () => start(1));
    this.input.keyboard.once('keydown', (e) => start(e.key === '2' ? 2 : 1));
  }
}
