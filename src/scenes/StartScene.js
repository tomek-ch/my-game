import Phaser from 'phaser';
import { TUNING } from '../tuning.js';
import { addDungeon } from '../world/dungeon.js';
import { pixelText } from '../ui/pixelFont.js';
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
const PREV_KEYS = ['ArrowLeft', 'a', 'A'];
const NEXT_KEYS = ['ArrowRight', 'd', 'D'];
const PAD_PREV = [14, 4]; // d-pad left, LB
const PAD_NEXT = [15, 5]; // d-pad right, RB

// ?join=<code> joins that online room straight away, once (not again on coming back to the title).
let joinFromUrl = new URLSearchParams(location.search).get('join');

const deviceName = (device) => (device === 'kbm' ? 'Keyboard + mouse' : `Gamepad ${device + 1}`);

// The title screen: a class picker, and that class's controls over a dimmed dungeon, for a gamepad if
// one is connected and for the keyboard and mouse otherwise; Tab, X or clicking a tab switches between
// them by hand. Left / right (arrows, A / D, the d-pad, LB / RB, or clicking the arrows) picks the
// class. A click or another key starts a solo run on keyboard and mouse, A on a gamepad a solo run on
// that gamepad. 2 or Y opens co-op: that device is player 1 with the class picked so far, the picker
// moves on to player 2's class, and the run starts when a second device joins (another gamepad, or the
// keyboard and mouse). Open the game with ?class=berserker to start on that class.
// Online co-op (a first spike, see src/net/): H hosts a room on the keyboard and mouse and shows its
// code; J asks for a code and joins that room as player 2 with the class picked here.
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
    for (const arrow of this.arrows) arrow.setInteractive({ useHandCursor: true }).setAlpha(0.6);

    pixelText(this, cx, 282, 'Controls', 4).setOrigin(0.5).setTint(BLOOD[3]);
    this.tabs = {
      kbm: pixelText(this, cx - 20, 320, VIEWS.kbm.tab, 2).setOrigin(1, 0.5),
      pad: pixelText(this, cx + 20, 320, VIEWS.pad.tab, 2).setOrigin(0, 0.5),
    };
    for (const tab of Object.values(this.tabs)) tab.setInteractive({ useHandCursor: true });
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

    const blink = (text) => {
      this.tweens.add({ targets: text, alpha: 0.3, duration: 600, yoyo: true, repeat: -1 });
      return text;
    };
    this.titleHints = [
      blink(pixelText(this, cx, height - 110, 'Click, press a key or A on a gamepad to start', 2).setOrigin(0.5)),
      pixelText(this, cx, height - 80, 'Co-op: press 2, or Y on a gamepad', 2).setOrigin(0.5).setAlpha(0.6),
      pixelText(this, cx, height - 55, 'Online: H to host, J to join', 2).setOrigin(0.5).setAlpha(0.6),
    ];
    this.joinP1 = pixelText(this, cx, height - 120, '', 2).setOrigin(0.5).setTint(KEY_COLOR);
    this.joinP2 = blink(pixelText(this, cx, height - 95, '', 2).setOrigin(0.5).setTint(PAD_COLOR));
    this.joinBack = pixelText(this, cx, height - 60, 'Esc or B to go back', 2).setOrigin(0.5).setAlpha(0.6);
    this.online = null; // set while hosting or joining a room
    this.showTitle();

    this.started = false; // a click and a key press can land in the same frame
    this.input.mouse.disableContextMenu();
    this.input.on('pointerdown', (pointer, over) => {
      const tab = Object.keys(this.tabs).find((view) => over.includes(this.tabs[view]));
      const arrow = this.arrows.findIndex((a) => over.includes(a));
      if (tab) this.pickView(tab);
      else if (arrow >= 0) this.cycleClass('kbm', arrow === 0 ? -1 : 1);
      else this.onPress('kbm');
    });
    this.input.keyboard.on('keydown', (e) => {
      if (e.repeat) return;
      if (e.key === 'Escape') this.showTitle();
      else if (e.key === 'Tab') {
        e.preventDefault(); // keep focus on the game
        this.pickView(this.view === 'kbm' ? 'pad' : 'kbm');
      } else if (this.online) return;
      else if (e.key === 'h' || e.key === 'H') this.hostOnline();
      else if (e.key === 'j' || e.key === 'J') this.joinOnline(window.prompt('Room code'));
      else if (PREV_KEYS.includes(e.key)) this.cycleClass('kbm', -1);
      else if (NEXT_KEYS.includes(e.key)) this.cycleClass('kbm', 1);
      else this.onPress('kbm', e.key === '2');
    });
    this.input.gamepad.on('down', (pad, button) => {
      if (button.index === PAD.back) this.showTitle();
      else if (button.index === PAD.view) this.pickView(this.view === 'kbm' ? 'pad' : 'kbm');
      else if (PAD_PREV.includes(button.index)) this.cycleClass(pad.index, -1);
      else if (PAD_NEXT.includes(button.index)) this.cycleClass(pad.index, 1);
      else this.onPress(pad.index, button.index === PAD.coop);
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

  showTitle() {
    this.online?.cancel?.();
    this.online = null;
    this.p1 = null;
    this.slot = 0;
    this.showClass();
    for (const t of this.titleHints) t.setVisible(true);
    for (const t of [this.joinP1, this.joinP2, this.joinBack]) t.setVisible(false);
  }

  showJoin(p1) {
    this.p1 = p1;
    this.slot = 1;
    this.showClass();
    for (const t of this.titleHints) t.setVisible(false);
    const p1Class = CLASSES[CLASS_IDS[this.picks[0]]].title;
    this.joinP1.setText(`P1: ${deviceName(p1)} - ${p1Class}`.toUpperCase()).setVisible(true);
    const waiting = p1 === 'kbm' ? 'P2: pick a class, then press A on a gamepad' : 'P2: pick a class, then press A on another gamepad, or click';
    this.joinP2.setText(waiting.toUpperCase()).setVisible(true);
    this.joinBack.setVisible(true);
  }

  // Online status in place of the hints: two lines and the way back.
  showOnline(line1, line2 = '') {
    for (const t of this.titleHints) t.setVisible(false);
    this.joinP1.setText(line1.toUpperCase()).setVisible(true);
    this.joinP2.setText(line2.toUpperCase()).setVisible(true);
    this.joinBack.setVisible(true);
  }

  // Opens a room and waits for a guest; the run starts when one says hello with its class.
  async hostOnline() {
    const session = (this.online = { cancel: null });
    this.showOnline('Opening a room...');
    try {
      const room = await hostRoom((link) => {
        if (this.online !== session) return link.close();
        link.once('hello', (msg) => this.startOnline(link, msg.class));
      });
      if (this.online !== session) return room.cancel();
      session.cancel = room.cancel;
      this.showOnline(`Room code: ${room.code}`, 'Waiting for P2 to press J and enter it');
    } catch (err) {
      if (this.online === session) this.showOnline('Could not open a room', err.message);
    }
  }

  startOnline(link, guestClass) {
    const classes = [CLASS_IDS[this.picks[0]], CLASSES[guestClass] ? guestClass : 'knight'];
    if (!this.started) this.scene.start('game', { devices: ['kbm', 'remote'], classes, link });
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

  // A press on `device`. `coop` asks for co-op instead of a solo run.
  onPress(device, coop = false) {
    if (this.online) return;
    if (this.p1 === null) {
      if (coop) this.showJoin(device);
      else this.start([device]);
    } else if (device !== this.p1) {
      this.start([this.p1, device]); // P1's own presses just wait for player 2
    }
  }

  start(devices) {
    const classes = devices.map((_, i) => CLASS_IDS[this.picks[i]]);
    if (!this.started) this.scene.start('game', { devices, classes });
    this.started = true;
  }
}
