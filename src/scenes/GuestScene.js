import Phaser from 'phaser';
import { TUNING } from '../tuning.js';
import { addDungeon } from '../world/dungeon.js';
import { pixelText } from '../ui/pixelFont.js';
import { MouseKeyboardControls, PRESSES, inputMessage } from '../input/controls.js';

const SLOT_COLORS = [0xf2c14e, 0x5ce1ff]; // P1 and P2, as on the start screen and HUD

// The guest's side of an online game (a first spike). The host runs the whole game; this scene reads
// the keyboard and mouse and sends them over the link to drive player 2 (see RemoteControls). What it
// shows is only the dungeon under the host's camera and a ring where each player is, which is enough
// to aim with the mouse. Esc leaves.
export class GuestScene extends Phaser.Scene {
  constructor() {
    super('guest');
  }

  // data.link: the Link to the host.
  init(data) {
    this.link = data.link;
  }

  create() {
    const { width: W, height: H } = TUNING.world;
    addDungeon(this, W, H);
    this.cameras.main.centerOn(W / 2, H / 2);

    const r = TUNING.player.radius;
    this.markers = SLOT_COLORS.map((color) => this.add.circle(0, 0, r).setStrokeStyle(3, color).setDepth(10).setVisible(false));
    const { width } = this.cameras.main;
    this.status = pixelText(this, width / 2, 30, 'Connected - waiting for the host', 2).setOrigin(0.5).setDepth(20);
    pixelText(this, width / 2, 60, 'You are P2. The game shows on the host screen for now', 2).setOrigin(0.5).setDepth(20).setAlpha(0.6);

    this.controls = new MouseKeyboardControls(this);
    this.sentPresses = Object.fromEntries(PRESSES.map((key) => [key, this.controls[key]]));
    this.lastInput = null;
    this.view = null;

    const onView = (view) => this.showView(view);
    const onClose = () => this.status.setText('Host disconnected - Esc for the title'.toUpperCase()).setTint(0xff6b6b);
    this.link.on('view', onView).on('close', onClose);
    this.events.once('shutdown', () => this.link.off('view', onView).off('close', onClose));

    this.input.keyboard.on('keydown-ESC', () => {
      this.link.close();
      this.scene.start('start');
    });
  }

  showView(view) {
    this.view = view;
    this.cameras.main.setScroll(view.cam[0], view.cam[1]);
    view.players.forEach(([x, y, alive], i) => this.markers[i]?.setPosition(x, y).setVisible(alive));
    const status = view.over ? 'Game over - the host restarts' : 'Online co-op';
    this.status.setText(status.toUpperCase()).clearTint();
  }

  update() {
    const me = this.view?.players[1];
    if (!me || !this.link.open) return;
    const c = this.controls;
    c.update({ x: me[0], y: me[1] });

    // Only send what changed; with a mouse that's still most frames, as the camera moves under it.
    // Input goes before presses, so a press lands with the aim it was made with.
    const msg = inputMessage(c);
    const json = JSON.stringify(msg);
    if (json !== this.lastInput) {
      this.lastInput = json;
      this.link.send(msg);
    }
    for (const key of PRESSES) {
      if (c[key] === this.sentPresses[key]) continue;
      this.sentPresses[key] = c[key];
      this.link.send({ t: 'press', button: key });
    }
  }
}
