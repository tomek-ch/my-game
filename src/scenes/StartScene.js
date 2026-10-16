import Phaser from 'phaser';
import { TUNING } from '../tuning.js';
import { addDungeon } from '../world/dungeon.js';
import { pixelText } from '../ui/pixelFont.js';
import { BLOOD } from '../textures.js';
import { PAD } from '../input/controls.js';
import { CLASSES } from '../classes/index.js';

const UI = 3; // screen pixels per font pixel for the control rows
const KEY_COLOR = 0xf2c14e;
const PAD_COLOR = 0x5ce1ff;
// The controls list shows one device at a time: the class's actions with that device's inputs.
const VIEWS = {
  kbm: { tab: 'Keyboard', color: KEY_COLOR },
  pad: { tab: 'Gamepad', color: PAD_COLOR },
};
const INPUT_RIGHT = 480; // inputs are right-aligned to here, actions left-aligned after a gap
const ACTION_LEFT = 520;

const deviceName = (device) => (device === 'kbm' ? 'Keyboard + mouse' : `Gamepad ${device + 1}`);

// The title screen: the controls over a dimmed dungeon, for a gamepad if one is connected and for the
// keyboard and mouse otherwise; Tab, X or clicking a tab switches between them by hand. A click or
// key starts a solo run on keyboard and mouse, A on a gamepad a solo run on that gamepad. 2 or Y opens
// co-op: that device is player 1, and the run starts when a second device joins (another gamepad, or
// the keyboard and mouse).
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

    pixelText(this, cx, 250, 'Controls', 5).setOrigin(0.5).setTint(BLOOD[3]);
    this.tabs = {
      kbm: pixelText(this, cx - 20, 300, VIEWS.kbm.tab, 2).setOrigin(1, 0.5),
      pad: pixelText(this, cx + 20, 300, VIEWS.pad.tab, 2).setOrigin(0, 0.5),
    };
    for (const tab of Object.values(this.tabs)) tab.setInteractive({ useHandCursor: true });
    pixelText(this, cx, 300, '/', 2).setOrigin(0.5).setAlpha(0.4);
    this.kit = CLASSES.knight;
    this.inputRows = this.kit.controls.map(({ action }, i) => {
      const y = 335 + i * 42;
      pixelText(this, ACTION_LEFT, y, action, UI);
      return pixelText(this, INPUT_RIGHT, y, '', UI).setOrigin(1, 0);
    });
    // Follow the connected devices until a view is picked by hand.
    this.viewPicked = false;
    const followPads = () => {
      // Phaser keeps disconnected pads in its list, so ask the browser.
      const padConnected = [...(navigator.getGamepads?.() ?? [])].some((pad) => pad?.connected);
      if (!this.viewPicked) this.showView(padConnected ? 'pad' : 'kbm');
    };
    followPads();
    this.input.gamepad.on('connected', followPads);
    this.input.gamepad.on('disconnected', followPads);

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
    this.input.on('pointerdown', (pointer, over) => {
      const tab = Object.keys(this.tabs).find((view) => over.includes(this.tabs[view]));
      if (tab) this.pickView(tab);
      else this.onPress('kbm');
    });
    this.input.keyboard.on('keydown', (e) => {
      if (e.repeat) return;
      if (e.key === 'Escape') this.showTitle();
      else if (e.key === 'Tab') {
        e.preventDefault(); // keep focus on the game
        this.pickView(this.view === 'kbm' ? 'pad' : 'kbm');
      } else this.onPress('kbm', e.key === '2');
    });
    this.input.gamepad.on('down', (pad, button) => {
      if (button.index === PAD.back) this.showTitle();
      else if (button.index === PAD.view) this.pickView(this.view === 'kbm' ? 'pad' : 'kbm');
      else this.onPress(pad.index, button.index === PAD.coop);
    });
  }

  showView(view) {
    this.view = view;
    const { color } = VIEWS[view];
    this.inputRows.forEach((row, i) => row.setText(this.kit.controls[i][view].toUpperCase()).setTint(color));
    for (const [name, tab] of Object.entries(this.tabs)) {
      if (name === view) tab.setTint(VIEWS[name].color).setAlpha(1);
      else tab.clearTint().setAlpha(0.4);
    }
  }

  pickView(view) {
    this.viewPicked = true;
    this.showView(view);
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
