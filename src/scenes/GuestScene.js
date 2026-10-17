import Phaser from 'phaser';
import { TUNING } from '../tuning.js';
import { addDungeon } from '../world/dungeon.js';
import { pixelText } from '../ui/pixelFont.js';
import { Hud } from '../ui/Hud.js';
import { CLASSES } from '../classes/index.js';
import { MouseKeyboardControls, PRESSES, inputMessage } from '../input/controls.js';
import { MirrorReceiver } from '../net/mirror.js';
import { EventPlayer } from '../net/events.js';
import { Fx } from '../fx.js';
import { sfx } from '../audio/sfx.js';
import { localPlayer } from '../localPlayer.js';
import { CameraFocus, leanCamera, watchedPlayers } from '../camera.js';

// The guest's side of an online game. The host runs the whole game and sends what's on screen several
// times a second (see GameScene.syncGuest and src/net/mirror.js); this scene rebuilds it, draws the
// HUD from the host's numbers, plays the host's sounds and effects (src/net/events.js), and sends the
// keyboard and mouse back to drive player 2 (see RemoteControls). Its camera is its own, on player 2.
// M mutes, Esc leaves.
//
// Snapshots and effects are played back a little behind the host's clock (PLAYBACK_DELAY_MS), so
// there's usually a snapshot either side of the moment shown and things move smoothly between them.
// If snapshots stop coming, the picture holds on the last one rather than guessing ahead.
const PLAYBACK_DELAY_MS = 100; // two snapshots' worth, for the network's unevenness
const CLOCK_SETTLE = 0.02;     // how fast the estimate of the host's clock follows slower arrivals

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
    localPlayer.slot = 1; // effects that are P1's play as theirs, not ours
    this.fx = new Fx(this);
    sfx.init(this.sound.context);
    sfx.listener = this.cameraFocus.point;
    this.input.keyboard.on('keydown-M', () => sfx.toggleMute());
    this.effects = new EventPlayer({ sfx, fx: this.fx, hud: null }); // hud: see showSnapshot
    this.controls = new MouseKeyboardControls(this);
    this.sentPresses = Object.fromEntries(PRESSES.map((key) => [key, this.controls[key]]));
    this.lastInput = null;
    this.snaps = [];      // received, not shown yet, oldest first
    this.fxQueue = [];    // effect batches received, not played yet, oldest first
    this.shown = null;    // the last snapshot applied
    this.players = null;  // [x, y, alive] per player, between `shown` and the next snapshot
    this.clockOffset = null; // the host's clock minus ours (see syncClock)
    this.playbackTime = -Infinity; // the host time being shown
    this.run = null;
    this.hud = null;
    this.overShown = false;

    const onSnap = (snap) => this.receiveSnapshot(snap);
    // Effects from another run (just before a restart) are dropped.
    const onFx = (msg) => msg.run === this.run && this.fxQueue.push(msg);
    const onClose = () => this.status.setText('Host disconnected - Esc for the title'.toUpperCase()).setTint(0xff6b6b).setVisible(true);
    this.link.on('snap', onSnap).on('fx', onFx).on('close', onClose);
    this.events.once('shutdown', () => this.link.off('snap', onSnap).off('fx', onFx).off('close', onClose));

    this.input.keyboard.on('keydown-ESC', () => {
      this.link.close();
      this.scene.start('start');
    });

    if (this.firstSnap) this.receiveSnapshot(this.firstSnap);
  }

  receiveSnapshot(snap) {
    // A new run on the host: start over from this snapshot. It can't be skipped, since graphics only
    // send their shapes when they change.
    if (this.run !== null && snap.run !== this.run) {
      this.scene.restart({ link: this.link, snap });
      return;
    }
    if (this.run === null) {
      this.run = snap.run;
      this.hud = new Hud(this, TUNING.player.maxHp, snap.classes.map((id) => CLASSES[id]));
      this.effects.targets.hud = this.hud;
      this.status.setVisible(false);
    }
    this.syncClock(snap.time);
    this.snaps.push(snap);
  }

  // How far the host's clock is ahead of ours, from a snapshot's send time. The quickest arrival sets
  // it; slower ones lower it only gradually, so one late snapshot doesn't shake the picture.
  syncClock(hostTime) {
    const sample = hostTime - performance.now();
    if (this.clockOffset === null || sample > this.clockOffset) this.clockOffset = sample;
    else this.clockOffset += (sample - this.clockOffset) * CLOCK_SETTLE;
  }

  // Applies the snapshots and plays the effects that are due, and blends toward the next snapshot.
  playBack() {
    if (this.clockOffset === null) return;
    // Never backwards, even when the clock estimate drops.
    this.playbackTime = Math.max(this.playbackTime, performance.now() + this.clockOffset - PLAYBACK_DELAY_MS);
    while (this.snaps.length && this.snaps[0].time <= this.playbackTime) this.showSnapshot(this.snaps.shift());
    while (this.fxQueue.length && this.fxQueue[0].time <= this.playbackTime) this.effects.play(this.fxQueue.shift().events, this.time.now);
    const next = this.snaps[0];
    if (!this.shown || !next) return;
    const t = Phaser.Math.Clamp((this.playbackTime - this.shown.time) / (next.time - this.shown.time), 0, 1);
    this.mirror.blend(next.objects, t);
    this.players = this.shown.players.map(([x, y, alive], i) => {
      const [nx, ny] = next.players[i];
      return [x + (nx - x) * t, y + (ny - y) * t, alive];
    });
  }

  showSnapshot(snap) {
    const first = !this.shown;
    this.shown = snap;
    this.players = snap.players;
    if (first) {
      this.updateCamera(0);
      this.cameras.main.startFollow(this.cameraFocus.point, true, TUNING.camera.followLerp, TUNING.camera.followLerp);
      this.cameras.main.centerOn(this.cameraFocus.point.x, this.cameraFocus.point.y);
    }
    this.mirror.apply(snap.objects);
    if (snap.over && !this.overShown) {
      this.overShown = true;
      this.hud.showGameOver(snap.over, 'Waiting for the host to restart');
    }
  }

  // Follows player 2 as the host's camera follows player 1, and the host's player once ours is dead.
  updateCamera(dt) {
    const players = this.players.map(([x, y]) => ({ x, y }));
    const alive = this.players.map((p) => p[2]);
    this.cameraFocus.update(players, watchedPlayers(alive, 1), dt);
    const pointer = alive[1] && !this.shown.over ? this.controls.pointer : null;
    leanCamera(this.cameras.main, this.lookahead, pointer);
  }

  update(_time, delta) {
    this.playBack();
    if (!this.shown) return;
    const me = this.players[1];
    this.updateCamera(Math.min(delta, 50) / 1000);
    // Every frame, as on the host, for the HUD's own animations (a full bar's flash, the boss bar
    // draining); the numbers are the shown snapshot's. Muting is per machine.
    this.hud.update(this.time.now, { ...this.shown.hud, muted: sfx.muted });
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
