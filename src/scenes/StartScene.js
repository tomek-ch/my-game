import Phaser from 'phaser';
import { TUNING } from '../tuning.js';
import { addDungeon } from '../world/dungeon.js';
import { pixelText } from '../ui/pixelFont.js';
import { Button } from '../ui/Button.js';
import { BLOOD } from '../textures.js';
import { PAD } from '../input/controls.js';
import { CLASSES, CLASS_IDS } from '../classes/index.js';
import { hostRoom, joinRoom } from '../net/link.js';

const UI = 3; // screen pixels per font pixel for the control rows
const KEY_COLOR = 0xf2c14e;
const PAD_COLOR = 0x5ce1ff;
const SLOT_COLORS = [KEY_COLOR, PAD_COLOR]; // P1 and P2, as on the HUD
// The controls list shows one device at a time: the class's actions with that device's inputs.
const VIEWS = {
  kbm: { tab: 'Keyboard', color: KEY_COLOR },
  pad: { tab: 'Gamepad', color: PAD_COLOR },
};
const INPUT_RIGHT = 480; // inputs are right-aligned to here, actions left-aligned after a gap
const ACTION_LEFT = 520;
const MAX_ROWS = Math.max(...Object.values(CLASSES).map((Kit) => Kit.controls.length));
const PICKER_ARROW_X = 170; // the < > arrows sit this far either side of the class name
const BUTTON_Y = 650;
const BUTTON_GAP = 24;
const KEY_STEPS = {
  ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0],
  ArrowRight: [1, 0], d: [1, 0], D: [1, 0],
  ArrowUp: [0, -1], w: [0, -1], W: [0, -1],
  ArrowDown: [0, 1], s: [0, 1], S: [0, 1],
};
const CONFIRM_KEYS = ['Enter', ' '];
const PAD_STEPS = { 14: [-1, 0], 15: [1, 0], 12: [0, -1], 13: [0, 1] }; // the d-pad
const PAD_CLASS_STEPS = { 4: -1, 5: 1 }; // LB / RB pick the class wherever the focus is
const PAD_CONFIRM = 0; // A

// ?join=<code> joins that online room straight away, once (not again on coming back to the title).
let joinFromUrl = new URLSearchParams(location.search).get('join');

const deviceName = (device) => (device === 'kbm' ? 'Keyboard + mouse' : `Gamepad ${device + 1}`);

// The title screen: a class picker, and that class's controls over a dimmed dungeon, for a gamepad if
// one is connected and for the keyboard and mouse otherwise; Tab, X or clicking a tab switches between
// them by hand. Below them, buttons: Play, Local co-op, Host online and Join online. Nothing starts but
// a button. The mouse clicks them; the keys (arrows or WSAD, Enter or Space) and the d-pad and A move a
// focus between the class picker and the buttons and press the focused one. Left / right on the picker,
// clicking its arrows or LB / RB pick the class. The device that presses a button is player 1.
// Local co-op: player 1 keeps the class picked so far, the picker moves on to player 2's class, and the
// run starts when a second device joins: A on another gamepad, or the keyboard and mouse's own button.
// Open the game with ?class=berserker to start on that class.
// Online co-op (a first spike, see src/net/): Host opens a room and shows its code; Join asks for a
// code and joins that room as player 2 on the keyboard and mouse, with the class picked here.
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
    const wanted = CLASS_IDS.indexOf(new URLSearchParams(location.search).get('class'));
    this.picks = [Math.max(wanted, 0), Math.max(wanted, 0)]; // class index per player slot
    this.slot = 0; // whose class the picker shows
    this.hero = this.add.sprite(cx, 140, 'dungeon', 'knight_m_idle_anim_f0').setScale(5).setScrollFactor(0);
    this.className = pixelText(this, cx, 232, '', 4).setOrigin(0.5);
    this.arrows = [
      pixelText(this, cx - PICKER_ARROW_X, 232, '<', 4).setOrigin(0.5),
      pixelText(this, cx + PICKER_ARROW_X, 232, '>', 4).setOrigin(0.5),
    ];
    this.arrows.forEach((arrow, i) => {
      arrow.setInteractive({ useHandCursor: true });
      arrow.on('pointerdown', (pointer) => pointer.button === 0 && this.cycleClass('kbm', i === 0 ? -1 : 1));
    });

    pixelText(this, cx, 282, 'Controls', 4).setOrigin(0.5).setTint(BLOOD[3]);
    this.tabs = {
      kbm: pixelText(this, cx - 20, 320, VIEWS.kbm.tab, 2).setOrigin(1, 0.5),
      pad: pixelText(this, cx + 20, 320, VIEWS.pad.tab, 2).setOrigin(0, 0.5),
    };
    for (const [view, tab] of Object.entries(this.tabs)) {
      tab.setInteractive({ useHandCursor: true });
      tab.on('pointerdown', (pointer) => pointer.button === 0 && this.pickView(view));
    }
    pixelText(this, cx, 320, '/', 2).setOrigin(0.5).setAlpha(0.4);
    this.rows = Array.from({ length: MAX_ROWS }, (_, i) => {
      const y = 350 + i * 40;
      return {
        action: pixelText(this, ACTION_LEFT, y, '', UI),
        input: pixelText(this, INPUT_RIGHT, y, '', UI).setOrigin(1, 0),
      };
    });
    this.view = 'kbm';
    this.showClass();
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

    this.statusTop = pixelText(this, cx, BUTTON_Y - 90, '', 2).setOrigin(0.5).setTint(KEY_COLOR);
    this.statusBottom = pixelText(this, cx, BUTTON_Y - 60, '', 2).setOrigin(0.5).setTint(PAD_COLOR);
    this.tweens.add({ targets: this.statusBottom, alpha: 0.3, duration: 600, yoyo: true, repeat: -1 });

    const button = (label, onPress) => {
      const b = new Button(this, label, { color: KEY_COLOR, onPress, onHover: () => this.focusButton(b) });
      return b;
    };
    this.menuButtons = [
      button('Play', (device) => this.start([device])),
      button('Local co-op', (device) => this.showJoin(device)),
      button('Host online', (device) => this.hostOnline(device)),
      button('Join online', () => this.joinOnline(window.prompt('Room code'))),
    ];
    // In the co-op lobby, the keyboard and mouse join as player 2 with this (gamepads press A).
    this.joinKbmButton = button('P2 on keyboard', (device) => device === 'kbm' && this.start([this.p1, 'kbm']));
    this.backButton = button('Back', () => this.showTitle());
    this.allButtons = [...this.menuButtons, this.joinKbmButton, this.backButton];
    this.online = null; // set while hosting or joining a room
    this.showTitle();

    this.started = false; // a click and a key press can land in the same frame
    this.input.mouse.disableContextMenu();
    this.input.keyboard.on('keydown', (e) => {
      if (e.repeat) return;
      if (e.key === 'Escape') this.showTitle();
      else if (e.key === 'Tab') {
        e.preventDefault(); // keep focus on the game
        this.pickView(this.view === 'kbm' ? 'pad' : 'kbm');
      } else if (KEY_STEPS[e.key]) {
        e.preventDefault(); // Space and the arrows would scroll the page
        this.step('kbm', ...KEY_STEPS[e.key]);
      } else if (CONFIRM_KEYS.includes(e.key)) {
        e.preventDefault();
        this.confirm('kbm');
      }
    });
    this.input.gamepad.on('down', (pad, { index }) => {
      if (index === PAD.back) this.showTitle();
      else if (index === PAD.view) this.pickView(this.view === 'kbm' ? 'pad' : 'kbm');
      else if (PAD_CLASS_STEPS[index]) this.cycleClass(pad.index, PAD_CLASS_STEPS[index]);
      else if (PAD_STEPS[index]) this.step(pad.index, ...PAD_STEPS[index]);
      else if (index === PAD_CONFIRM) this.confirm(pad.index);
    });

    if (joinFromUrl) this.joinOnline(joinFromUrl);
    joinFromUrl = null;
  }

  get kit() {
    return CLASSES[CLASS_IDS[this.picks[this.slot]]];
  }

  // `device` asked for the previous (-1) or next (1) class. While waiting for player 2, player 1's
  // class is locked in and only the other devices pick.
  cycleClass(device, step) {
    if (this.online || (this.p1 !== null && device === this.p1)) return;
    const n = CLASS_IDS.length;
    this.picks[this.slot] = (this.picks[this.slot] + step + n) % n;
    this.showClass();
  }

  showClass() {
    const Kit = this.kit;
    const hero = Kit.heroes[this.slot % Kit.heroes.length];
    this.hero.play(`${hero}_idle`);
    this.className.setText(Kit.title.toUpperCase()).setTint(this.slot > 0 ? SLOT_COLORS[this.slot] : 0xffffff);
    this.rows.forEach((row, i) => row.action.setText((Kit.controls[i]?.action ?? '').toUpperCase()));
    this.showView(this.view);
  }

  showView(view) {
    this.view = view;
    const { color } = VIEWS[view];
    const { controls } = this.kit;
    this.rows.forEach((row, i) => row.input.setText((controls[i]?.[view] ?? '').toUpperCase()).setTint(color));
    for (const [name, tab] of Object.entries(this.tabs)) {
      if (name === view) tab.setTint(VIEWS[name].color).setAlpha(1);
      else tab.clearTint().setAlpha(0.4);
    }
  }

  pickView(view) {
    this.viewPicked = true;
    this.showView(view);
  }

  // Shows `buttons` in a row along the bottom, focusing the one at `focus` (or the class picker, at -1).
  showButtons(buttons, focus = 0) {
    for (const b of this.allButtons) b.setVisible(false);
    const total = buttons.reduce((sum, b) => sum + b.width, 0) + BUTTON_GAP * (buttons.length - 1);
    let x = (this.cameras.main.width - total) / 2;
    for (const b of buttons) {
      b.setPosition(x + b.width / 2, BUTTON_Y).setVisible(true);
      x += b.width + BUTTON_GAP;
    }
    this.buttons = buttons;
    this.lastButton = Math.max(focus, 0);
    this.setFocus(focus);
  }

  // Focus on the class picker (-1) or this.buttons[focus].
  setFocus(focus) {
    if (focus < 0 && this.online) focus = 0; // nothing to pick while online
    this.focus = Phaser.Math.Clamp(focus, -1, this.buttons.length - 1);
    this.buttons.forEach((b, i) => b.setFocused(i === this.focus));
    for (const arrow of this.arrows) {
      if (this.focus < 0) arrow.setTint(KEY_COLOR).setAlpha(1);
      else arrow.clearTint().setAlpha(0.6);
    }
  }

  focusButton(button) {
    const i = this.buttons.indexOf(button);
    if (i >= 0) this.setFocus(i);
  }

  // `device` pushed left / right (dx) or up / down (dy): up and down go between the class picker and
  // the buttons, left and right pick the class or the next button.
  step(device, dx, dy) {
    if (dy < 0) this.setFocus(-1);
    else if (dy > 0) this.setFocus(Math.max(this.lastButton ?? 0, 0));
    else if (this.focus < 0) this.cycleClass(device, dx);
    else this.setFocus(Phaser.Math.Clamp(this.focus + dx, 0, this.buttons.length - 1));
    if (this.focus >= 0) this.lastButton = this.focus;
  }

  // Enter, Space or A on `device`. In the co-op lobby, A on any gamepad but player 1's joins as player 2.
  confirm(device) {
    if (this.p1 !== null && device !== 'kbm' && device !== this.p1) this.start([this.p1, device]);
    else if (this.focus < 0) this.step(device, 0, 1);
    else this.buttons[this.focus].press(device);
  }

  showTitle() {
    this.online?.cancel?.();
    this.online = null;
    this.p1 = null;
    this.slot = 0;
    this.showClass();
    this.statusTop.setVisible(false);
    this.statusBottom.setVisible(false);
    this.showButtons(this.menuButtons);
  }

  showJoin(p1) {
    this.p1 = p1;
    this.slot = 1;
    this.showClass();
    const p1Class = CLASSES[CLASS_IDS[this.picks[0]]].title;
    this.statusTop.setText(`P1: ${deviceName(p1)} - ${p1Class}`.toUpperCase()).setVisible(true);
    const waiting = p1 === 'kbm' ? 'P2: pick a class, then press A on a gamepad' : 'P2: pick a class, then press A on another gamepad';
    this.statusBottom.setText(waiting.toUpperCase()).setVisible(true);
    // The picker now shows player 2's class, so focus it for whoever picks next.
    this.showButtons(p1 === 'kbm' ? [this.backButton] : [this.joinKbmButton, this.backButton], -1);
  }

  // Online status above a lone Back button.
  showOnline(line1, line2 = '') {
    this.statusTop.setText(line1.toUpperCase()).setVisible(true);
    this.statusBottom.setText(line2.toUpperCase()).setVisible(true);
    if (this.buttons[0] !== this.backButton) this.showButtons([this.backButton]);
  }

  // Opens a room and waits for a guest; the run starts when one says hello with its class. `device`
  // plays player 1.
  async hostOnline(device) {
    const session = (this.online = { cancel: null });
    this.showOnline('Opening a room...');
    try {
      const room = await hostRoom((link) => {
        if (this.online !== session) return link.close();
        link.once('hello', (msg) => this.startOnline(link, msg.class, device));
      });
      if (this.online !== session) return room.cancel();
      session.cancel = room.cancel;
      this.showOnline(`Room code: ${room.code}`, 'Waiting for P2 to press Join online and enter it');
    } catch (err) {
      if (this.online === session) this.showOnline('Could not open a room', err.message);
    }
  }

  startOnline(link, guestClass, device) {
    const classes = [CLASS_IDS[this.picks[0]], CLASSES[guestClass] ? guestClass : 'knight'];
    if (!this.started) this.scene.start('game', { devices: [device, 'remote'], classes, link });
    this.started = true;
  }

  async joinOnline(code) {
    code = code?.trim();
    if (!code) return;
    const session = (this.online = {});
    this.showOnline(`Joining ${code}...`);
    try {
      const link = await joinRoom(code);
      if (this.online !== session || this.started) return link.close();
      link.send({ t: 'hello', class: CLASS_IDS[this.picks[0]] });
      this.started = true;
      this.scene.start('guest', { link });
    } catch (err) {
      if (this.online === session) this.showOnline('Could not join', err.message);
    }
  }

  start(devices) {
    const classes = devices.map((_, i) => CLASS_IDS[this.picks[i]]);
    if (!this.started) this.scene.start('game', { devices, classes });
    this.started = true;
  }
}
