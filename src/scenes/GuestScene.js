import Phaser from 'phaser';
import { TUNING } from '../tuning.js';
import { addDungeon } from '../world/dungeon.js';
import { pixelText } from '../ui/pixelFont.js';
import { Hud } from '../ui/Hud.js';
import { CLASSES } from '../classes/index.js';
import { MouseKeyboardControls, PRESSES, inputMessage } from '../input/controls.js';
import { MirrorReceiver } from '../net/mirror.js';
import { CameraFocus, leanCamera, watchedPlayers } from '../camera.js';

// The guest's side of an online game. The host runs the whole game and sends what's on screen several
// times a second (see GameScene.sendSnapshot and src/net/mirror.js); this scene rebuilds it, draws the
// HUD from the host's numbers, and sends the keyboard and mouse back to drive player 2 (see
// RemoteControls). Its camera is its own, on player 2. Esc leaves.
export class GuestScene extends Phaser.Scene {
  constructor() {
    super('guest');
  }

  // data.link: the Link to the host. data.snap: a snapshot to show straight away, when restarting
  // for a new run.
  init(data) {
    this.link = data.link;
    this.firstSnap = data.snap ?? null;
  }

  create() {
    const { width: W, height: H } = TUNING.world;
    const art = addDungeon(this, W, H);
    const cam = this.cameras.main;
    cam.setBounds(art.x, art.y, art.width, art.height); // as the host's
    cam.centerOn(W / 2, H / 2);
    this.cameraFocus = new CameraFocus();
    this.lookahead = new Phaser.Math.Vector2();

    const { width } = this.cameras.main;
    this.status = pixelText(this, width / 2, 30, 'Connected - waiting for the host', 2).setOrigin(0.5).setDepth(1000);

    this.mirror = new MirrorReceiver(this);
    this.controls = new MouseKeyboardControls(this);
    this.sentPresses = Object.fromEntries(PRESSES.map((key) => [key, this.controls[key]]));
    this.lastInput = null;
    this.snap = null;
    this.run = null;
    this.hud = null;
    this.overShown = false;

    const onSnap = (snap) => this.showSnapshot(snap);
    const onClose = () => this.status.setText('Host disconnected - Esc for the title'.toUpperCase()).setTint(0xff6b6b).setVisible(true);
    this.link.on('snap', onSnap).on('close', onClose);
    this.events.once('shutdown', () => this.link.off('snap', onSnap).off('close', onClose));

    this.input.keyboard.on('keydown-ESC', () => {
      this.link.close();
      this.scene.start('start');
    });

    if (this.firstSnap) this.showSnapshot(this.firstSnap);
  }

  showSnapshot(snap) {
    // A new run on the host: start over from this snapshot. It can't be skipped, since graphics only
    // send their shapes when they change.
    if (this.run !== null && snap.run !== this.run) {
      this.scene.restart({ link: this.link, snap });
      return;
    }
    if (this.run === null) {
      this.run = snap.run;
      this.hud = new Hud(this, TUNING.player.maxHp, snap.classes.map((id) => CLASSES[id]));
      this.status.setVisible(false);
    }
    const firstSnap = !this.snap;
    this.snap = snap;
    if (firstSnap) {
      this.updateCamera(0);
      this.cameras.main.startFollow(this.cameraFocus.point, true, TUNING.camera.followLerp, TUNING.camera.followLerp);
      this.cameras.main.centerOn(this.cameraFocus.point.x, this.cameraFocus.point.y);
    }
    this.mirror.apply(snap.objects);
    this.hud.update(this.time.now, snap.hud);
    if (snap.over && !this.overShown) {
      this.overShown = true;
      this.hud.showGameOver(snap.over, 'Waiting for the host to restart');
    }
  }

  // Follows player 2 as the host's camera follows player 1, and the host's player once ours is dead.
  updateCamera(dt) {
    const players = this.snap.players.map(([x, y]) => ({ x, y }));
    const alive = this.snap.players.map((p) => p[2]);
    this.cameraFocus.update(players, watchedPlayers(alive, 1), dt);
    const pointer = alive[1] && !this.snap.over ? this.controls.pointer : null;
    leanCamera(this.cameras.main, this.lookahead, pointer);
  }

  update(_time, delta) {
    const me = this.snap?.players[1];
    if (!me) return;
    this.updateCamera(Math.min(delta, 50) / 1000);
    if (!this.link.open) return;
    const c = this.controls;
    c.update({ x: me[0], y: me[1] });

    // Only send what changed; with a mouse that's still most frames, as the camera moves under it.
    // Input goes before presses, so a press lands with the aim it was made with.
    const msg = inputMessage(c, this.cameras.main.worldView);
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
