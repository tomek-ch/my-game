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
import { Prediction } from '../net/prediction.js';

// The guest's side of an online game. The host runs the whole game and sends what's on screen several
// times a second (see GameScene.syncGuest and src/net/mirror.js); this scene rebuilds it, draws the
// HUD from the host's numbers, plays the host's sounds and effects (src/net/events.js), and sends the
// keyboard and mouse back to drive player 2 (see RemoteControls). Its camera is its own, on player 2.
// M mutes, Esc leaves.
//
// Snapshots and effects are played back a little behind the host's clock (PLAYBACK_DELAY_MS), so
// there's usually a snapshot either side of the moment shown and things move smoothly between them.
// If snapshots stop coming, the picture holds on the last one rather than guessing ahead.
//
// The exception is our own player, which would then answer the keys a round trip plus that delay
// late: it's drawn where we predict it (src/net/prediction.js), and the camera follows that. Its
// look (an attack, the weapon's swing) and its own effects (its sounds, its screen shake) skip the
// delay: they come from the newest snapshot and play as they arrive.
const PLAYBACK_DELAY_MS = 90;  // ~3 snapshots: under ~30 ms of network jitter it rarely runs dry
const CLOCK_SETTLE = 0.02;     // how fast the estimate of the host's clock follows slower arrivals
const ME = 1;                  // our player's slot

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
    this.snaps = [];      // received, not shown yet, oldest first
    this.fxQueue = [];    // effect batches received, not played yet, oldest first
    this.shown = null;    // the last snapshot applied
    this.players = null;  // [x, y, alive] per player, between `shown` and the next snapshot
    this.clockOffset = null; // the host's clock minus ours (see syncClock)
    this.playbackTime = -Infinity; // the host time being shown
    this.prediction = new Prediction();
    this.run = null;
    this.hud = null;
    this.overShown = false;

    const onSnap = (snap) => this.receiveSnapshot(snap);
    // Effects from another run (just before a restart) are dropped.
    const onFx = (msg) => msg.run === this.run && this.receiveEffects(msg);
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
    this.checkPrediction(snap.players[ME], snap.inputAt);
  }

  // Starts predicting our player once there is one, stops when it dies, and otherwise checks the
  // prediction against where the host has it (see Prediction).
  checkPrediction([x, y, alive], inputAt) {
    const p = this.prediction;
    if (!alive) p.stop();
    else if (!p.active) p.start(x, y);
    else if (inputAt !== null) p.reconcile(x, y, inputAt);
  }

  // Our player's effects play now; the rest wait their turn with the picture.
  receiveEffects(msg) {
    const isMine = (event) => Array.isArray(event[2]) && event[2].some((arg) => arg?.slot === ME);
    const mine = msg.events.filter(isMine);
    if (mine.length) this.effects.play(mine, this.time.now);
    if (mine.length < msg.events.length) this.fxQueue.push({ ...msg, events: msg.events.filter((e) => !isMine(e)) });
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
    if (this.prediction.active) players[ME] = this.prediction.pos;
    const alive = this.players.map((p) => p[2]);
    this.cameraFocus.update(players, watchedPlayers(alive, 1), dt);
    const pointer = alive[1] && !this.shown.over ? this.controls.pointer : null;
    leanCamera(this.cameras.main, this.lookahead, pointer);
  }

  update(_time, delta) {
    const now = performance.now();
    this.playBack();
    if (!this.shown) return;
    const dt = Math.min(delta, 50) / 1000;
    const c = this.controls;
    const p = this.prediction;
    c.update(p.active ? p.pos : { x: this.players[ME][0], y: this.players[ME][1] });
    if (p.active) {
      p.step(c.move, dt, now);
      // Our player, its weapon and shadow: as the newest snapshot has them, where predicted.
      const newest = this.snaps.at(-1) ?? this.shown;
      const [x, y] = newest.players[ME];
      this.mirror.showAhead(newest.objects, newest.attached[ME], x, y, p.pos.x, p.pos.y);
    }
    this.updateCamera(dt);
    // Every frame, as on the host, for the HUD's own animations (a full bar's flash, the boss bar
    // draining); the numbers are the shown snapshot's. Muting is per machine.
    this.hud.update(this.time.now, { ...this.shown.hud, muted: sfx.muted });
    if (!this.link.open) return;

    // Every frame, stamped with our clock, so each snapshot can say which input the host had caught up
    // to (see Prediction). Input goes before presses, so a press lands with the aim it was made with.
    this.link.send(inputMessage(c, this.cameras.main.worldView, now));
    for (const key of PRESSES) {
      if (c[key] === this.sentPresses[key]) continue;
      this.sentPresses[key] = c[key];
      this.link.send({ t: 'press', button: key });
    }
  }
}
