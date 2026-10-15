import Phaser from 'phaser';
import { TUNING } from '../tuning.js';
import { addDungeon } from '../world/dungeon.js';
import { pixelText } from '../ui/pixelFont.js';
import { BLOOD } from '../textures.js';
import { PAD } from '../input/controls.js';

const UI = 3; // screen pixels per font pixel for the control rows
const KEY_COLOR = 0xf2c14e;
const PAD_COLOR = 0x5ce1ff;
const COLUMNS = { keys: 380, pad: 420, action: 660 }; // keys are right-aligned, the rest left-aligned
const CONTROLS = [
  ['WSAD', 'Left stick', 'Move'],
  ['Mouse', 'Right stick', 'Aim'],
  ['Space', 'RT / A', 'Dash'],
  ['Left click', 'RB', 'Melee'],
  ['Right click', 'LB', 'Shot - sword hits charge it'],
];

const deviceName = (device) => (device === 'kbm' ? 'Keyboard + mouse' : `Gamepad ${device + 1}`);

// The title screen: the controls over a dimmed dungeon. A click or key starts a solo run on keyboard
// and mouse, A on a gamepad a solo run on that gamepad. 2 or Y opens co-op: that device is player 1,
// and the run starts when a second device joins (another gamepad, or the keyboard and mouse).
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
    CONTROLS.forEach(([key, pad, action], i) => {
      const y = 320 + i * 42;
      pixelText(this, COLUMNS.keys, y, key, UI).setOrigin(1, 0).setTint(KEY_COLOR);
      pixelText(this, COLUMNS.pad, y, pad, UI).setTint(PAD_COLOR);
      pixelText(this, COLUMNS.action, y, action, UI);
    });

    const blink = (text) => {
      this.tweens.add({ targets: text, alpha: 0.3, duration: 600, yoyo: true, repeat: -1 });
      return text;
    };
    this.titleHints = [
      blink(pixelText(this, cx, height - 110, 'Click, press a key or A on a gamepad to start', 2).setOrigin(0.5)),
      pixelText(this, cx, height - 80, 'Co-op: press 2, or Y on a gamepad', 2).setOrigin(0.5).setAlpha(0.6),
    ];
    this.joinP1 = pixelText(this, cx, height - 120, '', 2).setOrigin(0.5).setTint(KEY_COLOR);
    this.joinP2 = blink(pixelText(this, cx, height - 95, '', 2).setOrigin(0.5).setTint(PAD_COLOR));
    this.joinBack = pixelText(this, cx, height - 60, 'Esc or B to go back', 2).setOrigin(0.5).setAlpha(0.6);
    this.showTitle();

    this.started = false; // a click and a key press can land in the same frame
    this.input.mouse.disableContextMenu();
    this.input.on('pointerdown', () => this.onPress('kbm'));
    this.input.keyboard.on('keydown', (e) => {
      if (e.repeat) return;
      if (e.key === 'Escape') this.showTitle();
      else this.onPress('kbm', e.key === '2');
    });
    this.input.gamepad.on('down', (pad, button) => {
      if (button.index === PAD.back) this.showTitle();
      else this.onPress(pad.index, button.index === PAD.coop);
    });
  }

  showTitle() {
    this.p1 = null;
    for (const t of this.titleHints) t.setVisible(true);
    for (const t of [this.joinP1, this.joinP2, this.joinBack]) t.setVisible(false);
  }

  showJoin(p1) {
    this.p1 = p1;
    for (const t of this.titleHints) t.setVisible(false);
    this.joinP1.setText(`P1: ${deviceName(p1)}`.toUpperCase()).setVisible(true);
    const waiting = p1 === 'kbm' ? 'P2: press A on a gamepad' : 'P2: press A on another gamepad, or click';
    this.joinP2.setText(waiting.toUpperCase()).setVisible(true);
    this.joinBack.setVisible(true);
  }

  // A press on `device`. `coop` asks for co-op instead of a solo run.
  onPress(device, coop = false) {
    if (this.p1 === null) {
      if (coop) this.showJoin(device);
      else this.start([device]);
    } else if (device !== this.p1) {
      this.start([this.p1, device]); // P1's own presses just wait for player 2
    }
  }

  start(devices) {
    if (!this.started) this.scene.start('game', { devices });
    this.started = true;
  }
}
