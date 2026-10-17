import Phaser from 'phaser';
import { TUNING } from '../tuning.js';
import { Player } from '../entities/Player.js';
import { ENEMY_TYPES } from '../entities/enemies/index.js';
import { summonWarden } from '../entities/enemies/Warden.js';
import { Spawner } from '../systems/Spawner.js';
import { addDungeon } from '../world/dungeon.js';
import { ART_SCALE } from '../art.js';
import { Hud } from '../ui/Hud.js';
import { Fx } from '../fx.js';
import { SOUNDS, sfx } from '../audio/sfx.js';
import { createControls } from '../input/controls.js';
import { freeze, isFrozen, thaw } from '../entities/hitstop.js';
import { CLASSES } from '../classes/index.js';
import { MirrorSender } from '../net/mirror.js';
import { EventRecorder } from '../net/events.js';
import { CameraFocus, leanCamera, watchedPlayers } from '../camera.js';
import { localPlayer } from '../localPlayer.js';
import { PREDICTED_ABILITIES } from '../net/abilities.js';

const MAX_PLAYERS = 2;
const LEASH_MARGIN = 40; // local co-op players can't walk further apart than the screen, minus this
// ?boss=<seconds> makes the warden arrive then instead of at its usual time, for testing.
const BOSS_AT = Number(new URLSearchParams(location.search).get('boss') ?? NaN);
const SNAPSHOT_INTERVAL_MS = 33; // how often an online host sends the guest what's on screen (~30/s)
// The one-off effects an online guest is told about (see src/net/events.js). The rest of Fx works on
// sprites and graphics, which reach the guest with the screen.
const GUEST_FX = ['hitSparks', 'bloodBurst', 'dashDust', 'ember', 'projectileTrail', 'shake', 'hurtFlash'];
const GUEST_HUD = ['announceBoss', 'bossSlain', 'banner', 'shakeResource'];

export class GameScene extends Phaser.Scene {
  constructor() {
    super('game');
  }

  // data.devices: one input device per local player, 'kbm' or a gamepad index (see controls.js).
  // data.classes: each player's class id (see src/classes/), knight if missing.
  // data.link: in an online game, the Link to the guest, whose player's device is 'remote' (see src/net/).
  init(data) {
    this.link = data?.link ?? null;
    this.devices = (data?.devices ?? ['kbm']).slice(0, MAX_PLAYERS);
    this.classes = this.devices.map((_, i) => (CLASSES[data?.classes?.[i]] ? data.classes[i] : 'knight'));
    this.playerCount = this.devices.length;
  }

  create() {
    // The scene clock only advances in this scene's update(), so on a first start it still holds
    // the time the game booted; the run's start (timer, spawn ramp) would count from the title screen.
    this.time.now = this.game.loop.time;
    const { width: W, height: H } = TUNING.world;

    this.physics.world.setBounds(0, 0, W, H);
    const art = addDungeon(this, W, H);
    this.mirror = this.link ? new MirrorSender(this) : null; // see syncGuest()

    const coop = this.playerCount > 1;
    localPlayer.slot = this.link ? 0 : null; // online the host plays P1; otherwise every player is here
    this.players = [];
    for (let i = 0; i < this.playerCount; i++) {
      const controls = createControls(this, this.devices[i], this.link);
      const x = W / 2 + (i - (this.playerCount - 1) / 2) * 60;
      const Kit = CLASSES[this.classes[i]];
      const player = new Player(this, x, H / 2, { hero: Kit.heroes[i % Kit.heroes.length], weapon: Kit.weapon, controls });
      player.kit = new Kit(this, player);
      player.slot = i; // whose effects are whose, see localPlayer.js
      this.players.push(player);
    }
    this.enemies = this.physics.add.group();
    // Enemy-vs-enemy contact skips Arcade: its circle separation zeroes both velocities (velocity *
    // bounce, bounce 0) on every touch, even in overlap-only mode, so packed enemies crawled.
    // (The world is rebuilt on restart, so these listeners need no cleanup.)
    this.physics.world.on('worldstep', this.separateEnemies, this);
    // Online each player has a screen of their own, so nothing has to keep them on one.
    if (coop && !this.link) this.physics.world.on('worldstep', this.leashPlayers, this);
    this.physics.add.overlap(this.players, this.enemies, (player, enemy) => this.onPlayerTouched(player, enemy));
    this.bolts = this.physics.add.group();
    this.physics.add.overlap(this.bolts, this.enemies, (bolt, enemy) => this.onBoltHit(bolt, enemy));
    this.enemyBullets = this.physics.add.group();
    this.physics.add.overlap(this.players, this.enemyBullets, (player, bullet) => this.onEnemyBulletHit(player, bullet));

    // The camera (and the ears) follow the middle of the living players, or online this machine's
    // player (see updateFocus).
    this.cameraFocus = new CameraFocus();
    this.focus = this.cameraFocus.point;
    this.updateFocus(0);
    const cam = this.cameras.main;
    cam.setBounds(art.x, art.y, art.width, art.height); // includes the north wall above the floor
    cam.startFollow(this.focus, true, TUNING.camera.followLerp, TUNING.camera.followLerp);
    this.lookahead = new Phaser.Math.Vector2();

    this.fx = new Fx(this);
    sfx.init(this.sound.context);
    sfx.listener = this.focus;
    this.input.keyboard.on('keydown-M', () => sfx.toggleMute());
    this.spawner = new Spawner(this, (x, y, type) => this.spawnEnemy(x, y, type));
    // The boss arrives once, at a set time; the waves keep coming around it.
    this.boss = null;
    const bossAt = Number.isFinite(BOSS_AT) ? BOSS_AT : TUNING.enemies.warden.arrival.at;
    this.time.delayedCall(bossAt * 1000, () => !this.isOver && summonWarden(this));

    this.input.on('pointerdown', () => this.isOver && this.tryRestart());
    this.input.keyboard.on('keydown-R', () => this.isOver && this.tryRestart());
    this.input.gamepad.on('down', () => this.isOver && this.tryRestart());

    this.frozen = new Set(); // sprites in hitstop, see hitstop.js
    this.kills = 0;
    this.startedAt = this.time.now;
    this.isOver = false;

    // Arcade copies body positions onto sprites after update(), so anything placed relative to a
    // sprite is synced here; doing it in update() drew it a frame behind.
    this.events.on('postupdate', this.syncVisuals, this);
    // Before physics, so a sprite coming out of hitstop moves this frame. Thawed in update(), Arcade had
    // already stepped it as frozen, while its dash or step counted the frame down: hits cut dashes short.
    this.events.on('preupdate', this.thawFrozen, this);
    this.events.once('shutdown', () => {
      this.events.off('postupdate', this.syncVisuals, this);
      this.events.off('preupdate', this.thawFrozen, this);
    });

    this.hud = new Hud(this, TUNING.player.maxHp, this.classes.map((id) => CLASSES[id]));

    if (this.link) {
      // A player passed to an effect (whose it is) goes as their slot and where they are.
      this.recorder = new EventRecorder((arg) => (arg instanceof Player ? { slot: arg.slot, x: arg.x, y: arg.y } : arg));
      this.recorder.record('sfx', sfx, SOUNDS, { sounds: true });
      this.recorder.record('fx', this.fx, GUEST_FX);
      this.recorder.record('hud', this.hud, GUEST_HUD);
      // After syncVisuals, so the guest gets this frame's picture. It keeps going after game over.
      this.events.on('postupdate', this.syncGuest, this);
      this.events.once('shutdown', () => {
        this.events.off('postupdate', this.syncGuest, this);
        this.recorder.dispose(); // sfx outlives the scene
      });
      this.runId = Date.now(); // tells the guest a restart from the next snapshot
      this.nextSnapshotAt = 0;
    }
  }

  update(_time, delta) {
    if (this.isOver) return;
    const now = this.time.now;
    const dt = Math.min(delta, 50) / 1000;
    for (const p of this.livingPlayers()) {
      if (isFrozen(p, now)) continue; // buffered presses wait for the hitstop to end
      const c = p.controls;
      c.update(p);
      if (c.aimAngle !== null) p.aimAngle = c.aimAngle;
      p.kit.update(now, dt);
    }
    this.updateProjectiles(this.bolts);
    this.updateProjectiles(this.enemyBullets);

    for (const enemy of this.enemies.getChildren()) {
      if (this.isOver) break; // the last player can fall to an enemy earlier in this loop
      if (enemy.dying || isFrozen(enemy, now)) continue;
      enemy.tick(dt, now);
    }

    this.updateCameraLookahead();
    this.updateHud(now);
  }

  // Online: this frame's one-off effects (see src/net/events.js), and every so often what's on screen
  // (see src/net/mirror.js) and where the players are, for the guest's camera and mouse aim.
  syncGuest() {
    const now = this.time.now;
    const events = this.recorder.take();
    if (!this.link.open) return;
    // The snapshot first: a new run's first one is what tells the guest to start over.
    if (now >= this.nextSnapshotAt) {
      this.nextSnapshotAt = now + SNAPSHOT_INTERVAL_MS;
      this.link.send({
        t: 'snap',
        run: this.runId,
        time: Math.round(now), // for the guest to play snapshots back evenly spaced
        classes: this.classes,
        players: this.players.map((p) => [Math.round(p.x), Math.round(p.y), p.alive]),
        objects: this.mirror.capture(),
        // What moves with each player (its effects are marked by Fx), for the guest to draw its own
        // where it predicts it to be.
        attached: this.players.map((p) => [p, p.weapon, p.shadow.image, ...this.children.list.filter((o) => o.attachedTo === p)]
          .map((o) => this.mirror.idOf(o))),
        ability: this.abilityState(this.players[1], now),
        // The latest input from the guest this frame had, by the guest's clock: what it has caught up to.
        inputAt: this.players[1].controls.inputAt,
        hud: this.hudData(this.isOver ? this.overAt : now),
        over: this.isOver ? this.overStats : null,
      });
    }
    if (events.length) this.link.send({ t: 'fx', run: this.runId, time: Math.round(now), events });
  }

  // Online: whether the guest's predicted ability (see src/net/abilities.js) is ready on the host, in ms
  // from now (null for not until something else happens, like a strike ending).
  abilityState(player, now) {
    const spec = PREDICTED_ABILITIES[this.classes[this.players.indexOf(player)]];
    if (!spec) return null;
    const ms = (t) => (t === Infinity ? null : Math.max(0, Math.round(t - now)));
    return { readyIn: ms(spec.readyAt(player)), stunIn: ms(player.stunUntil), busy: spec.busy(player) };
  }

  livingPlayers() {
    return this.players.filter((p) => p.alive);
  }

  nearestPlayer(x, y) {
    let best = null;
    let bestDist = Infinity;
    for (const p of this.livingPlayers()) {
      const dist = Phaser.Math.Distance.Squared(x, y, p.x, p.y);
      if (dist < bestDist) {
        best = p;
        bestDist = dist;
      }
    }
    return best;
  }

  // Projectiles fizzle out at their max range or the world edge.
  updateProjectiles(group) {
    const { width: W, height: H } = TUNING.world;
    const now = this.time.now;
    for (const shot of [...group.getChildren()]) {
      if (isFrozen(shot, now)) continue;
      const travelled = Phaser.Math.Distance.Between(shot.startX, shot.startY, shot.x, shot.y);
      const outside = shot.x < 0 || shot.y < 0 || shot.x > W || shot.y > H;
      if (travelled < shot.maxRange && !outside) {
        this.fx.projectileTrail(shot.x, shot.y, shot.trailTint, shot.trailCount);
        continue;
      }
      this.fx.hitSparks(shot.x, shot.y);
      shot.destroy();
    }
  }

  spawnEnemyBullet(x, y, angle, cfg) {
    const bullet = this.enemyBullets.create(x, y, 'orb-0').setScale(ART_SCALE).play('orb');
    bullet.body.setCircle(2.5, 1, 1); // art pixels: radius 5 on screen
    bullet.trailTint = 0xb15cff;
    bullet.setVelocity(Math.cos(angle) * cfg.bulletSpeed, Math.sin(angle) * cfg.bulletSpeed);
    bullet.setDepth(12);
    bullet.startX = x;
    bullet.startY = y;
    bullet.maxRange = cfg.bulletRange;
    bullet.damage = cfg.bulletDamage;
    bullet.knockback = cfg.bulletKnockback;
  }

  // Bullets pass through you while you're invulnerable, so dashing through them works.
  onEnemyBulletHit(player, bullet) {
    if (!bullet.active || !player.alive || player.isInvulnerable(this.time.now)) return;
    const dir = bullet.body.velocity.clone().normalize();
    bullet.destroy();
    this.damagePlayer(player, bullet.damage, dir, bullet.knockback);
  }

  // A player's projectile landing. bolt.cfg is the shooter's tuning (see TUNING.classes.knight.ranged
  // and TUNING.classes.mage.zap): a piercing bolt hits each enemy once, every one already passed through
  // adding damage; any other bolt stops at the first. bolt.hitSound names its sfx (boltHit if unset),
  // and bolt.onHit(enemy), if set, is told about each hit.
  onBoltHit(bolt, enemy) {
    if (!bolt.active || enemy.dying || bolt.pierced.has(enemy)) return;
    const now = this.time.now;
    const R = bolt.cfg;
    const damage = R.damage + (R.pierce ? R.pierceBonus * bolt.pierced.size : 0);
    bolt.pierced.add(enemy);
    const dir = bolt.body.velocity.clone().normalize();
    this.fx.shake(R.hitShake, bolt.owner);
    const hit = { damage, dir, knockback: R.knockback, stunMs: R.stunMs, heavy: R.heavy };
    if (this.strikeEnemy(enemy, hit, now, R.heavy ? 0.4 : 0.2)) {
      this.hitstop(R.killHitstopMs, bolt);
    } else {
      sfx[bolt.hitSound ?? 'boltHit'](enemy.x, enemy.y);
      if (R.hitstopMs > 0) this.hitstop(R.hitstopMs, bolt, enemy);
    }
    bolt.onHit?.(enemy);
    if (!R.pierce) bolt.destroy();
  }

  // A player's attack landing on `enemy` (hit as in Enemy.takeHit): sparks where it struck, then the
  // kill, or a flash and a squash by `squash`. Returns true if it killed.
  strikeEnemy(enemy, hit, now, squash) {
    const { dir } = hit;
    this.fx.hitSparks(enemy.x - dir.x * enemy.radius, enemy.y - dir.y * enemy.radius);
    if (enemy.takeHit(hit, now)) {
      this.killEnemy(enemy);
      return true;
    }
    this.fx.flash(enemy);
    this.fx.squash(enemy, squash);
    return false;
  }

  // Burn damage (see Enemy.ignite): no knockback, no stun, nothing to interrupt. Returns true if it killed.
  burnEnemy(enemy, damage) {
    enemy.hp -= damage;
    if (enemy.hp <= 0) {
      this.killEnemy(enemy);
      return true;
    }
    this.fx.flash(enemy, 50);
    return false;
  }

  // Deletes every enemy bullet that `inArea(x, y, radius)` accepts, with a ping. Returns how many.
  cutBullets(inArea) {
    let cut = 0;
    for (const bullet of [...this.enemyBullets.getChildren()]) {
      if (!inArea(bullet.x, bullet.y, 7)) continue;
      this.fx.hitSparks(bullet.x, bullet.y);
      sfx.deflect(bullet.x, bullet.y);
      bullet.destroy();
      cut++;
    }
    return cut;
  }

  // Nearest live enemy within `reach` of the player (plus its radius) and within `deg` of the aim.
  findTarget(p, reach, deg) {
    const cone = Phaser.Math.DegToRad(deg);
    let best = null;
    for (const enemy of this.enemies.getChildren()) {
      if (enemy.dying) continue;
      const dist = Phaser.Math.Distance.Between(p.x, p.y, enemy.x, enemy.y);
      if (dist > reach + enemy.radius || (best && dist >= best.dist)) continue;
      const angle = Math.atan2(enemy.y - p.y, enemy.x - p.x);
      if (Math.abs(Phaser.Math.Angle.Wrap(angle - p.aimAngle)) > cone) continue;
      best = { enemy, dist, angle };
    }
    return best;
  }

  killEnemy(enemy) {
    this.kills++;
    this.fx.bloodBurst(enemy.x, enemy.y - enemy.radius * 0.5, enemy.y + enemy.radius, enemy.radius / TUNING.enemies.grunt.radius);
    sfx.kill(enemy.x, enemy.y);
    enemy.die();
  }

  // An enemy's attack landing on the other enemies (the brute's swing and slam): everyone that
  // `inArea(enemy)` accepts is knocked away from (x, y). Kills count as the players'.
  hitEnemies(source, x, y, inArea, { damage, knockback, stunMs }) {
    const now = this.time.now;
    for (const enemy of [...this.enemies.getChildren()]) {
      if (enemy === source || enemy.dying || enemy.airborne || !inArea(enemy)) continue;
      const dir = new Phaser.Math.Vector2(enemy.x - x, enemy.y - y);
      if (dir.lengthSq() < 0.01) dir.setToPolar(Math.random() * Math.PI * 2);
      dir.normalize();
      this.strikeEnemy(enemy, { damage, dir, knockback, stunMs, heavy: true }, now, 0.3);
    }
  }

  spawnEnemy(x, y, type) {
    const enemy = new ENEMY_TYPES[type](this, x, y);
    this.enemies.add(enemy);
    enemy.setupBody();
    if (type === 'warden') this.boss = enemy;
    return enemy;
  }

  // The boss is down: the run goes on, with every living player healed a little.
  wardenSlain(warden) {
    if (this.boss === warden) this.boss = null;
    const heal = TUNING.enemies.warden.rewardHeal;
    for (const p of this.livingPlayers()) {
      if (p.hp >= TUNING.player.maxHp) continue;
      p.hp = Math.min(TUNING.player.maxHp, p.hp + heal);
      this.fx.flash(p, 160);
    }
    sfx.shotReady();
    this.hud.bossSlain('Warden slain');
  }

  syncVisuals() {
    if (this.isOver) return;
    for (const enemy of this.enemies.getChildren()) {
      if (!enemy.dying) enemy.syncVisuals();
    }
    for (const p of this.livingPlayers()) {
      p.syncVisuals(this.time.now);
      p.kit.syncVisuals(this.time.now);
    }
    this.updateFocus(Math.min(this.game.loop.delta, 50) / 1000);
  }

  updateFocus(dt) {
    const alive = this.players.map((p) => p.alive);
    this.cameraFocus.update(this.players, watchedPlayers(alive, this.link ? 0 : null), dt);
  }

  // The areas of the world on someone's screen, for spawning out of sight: this camera's, and online
  // the guest's, as it last reported.
  views() {
    const cam = this.cameras.main;
    const views = [cam.worldView];
    const guestView = this.link && this.players[1].controls.view;
    if (guestView) views.push(new Phaser.Geom.Rectangle(guestView[0], guestView[1], cam.width, cam.height));
    return views;
  }

  // Keeps co-op players within one screen (minus a margin) of each other, so the camera can always
  // show everyone. Each player is held against where the others were last step, so the edge is a
  // wall for whoever walks into it and nobody gets dragged along.
  leashPlayers() {
    const living = this.livingPlayers();
    if (living.length < 2) return;
    const cam = this.cameras.main;
    const spanX = cam.width - LEASH_MARGIN * 2;
    const spanY = cam.height - LEASH_MARGIN * 2;
    const before = new Map(living.map((p) => [p, p.leashedAt ?? p.body.center.clone()]));
    for (const p of living) {
      const b = p.body;
      const others = living.filter((o) => o !== p).map((o) => before.get(o));
      const xs = others.map((c) => c.x);
      const ys = others.map((c) => c.y);
      const dx = Phaser.Math.Clamp(b.center.x, Math.max(...xs) - spanX, Math.min(...xs) + spanX) - b.center.x;
      const dy = Phaser.Math.Clamp(b.center.y, Math.max(...ys) - spanY, Math.min(...ys) + spanY) - b.center.y;
      if (dx !== 0 || dy !== 0) {
        b.x += dx;
        b.y += dy;
        b.updateCenter();
      }
      p.leashedAt = b.center.clone();
    }
  }

  // Push overlapping enemies apart, the heavier one moving less. Velocity is left to the AI.
  separateEnemies() {
    const list = this.enemies.getChildren().filter((e) => e.body?.enable && !e.airborne);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        let dx = b.body.center.x - a.body.center.x;
        let dy = b.body.center.y - a.body.center.y;
        const dist = Math.hypot(dx, dy);
        const overlap = a.radius + b.radius - dist;
        if (overlap <= 0) continue;
        if (dist > 0) {
          dx /= dist;
          dy /= dist;
        } else {
          dx = 1;
          dy = 0;
        }
        const share = b.body.mass / (a.body.mass + b.body.mass);
        a.body.x -= dx * overlap * share;
        a.body.y -= dy * overlap * share;
        b.body.x += dx * overlap * (1 - share);
        b.body.y += dy * overlap * (1 - share);
        a.body.updateCenter();
        b.body.updateCenter();
      }
    }
  }

  onPlayerTouched(player, enemy) {
    const contact = enemy.contact(this.time.now);
    if (!contact) return;
    const dir = new Phaser.Math.Vector2(player.x - enemy.x, player.y - enemy.y).normalize();
    if (this.damagePlayer(player, contact.damage, dir, contact.knockback, enemy)) {
      enemy.knock(dir.clone().negate(), TUNING.player.hurtKnockback * 0.6, this.time.now);
    }
  }

  // Returns false if the player couldn't be hurt right now. `source` is the enemy that landed the
  // hit, if any, and shares the player's hitstop.
  damagePlayer(player, damage, dir, knockback, source = null) {
    const now = this.time.now;
    if (this.isOver || !player.alive || player.isInvulnerable(now)) return false;
    player.hurt(damage, dir, now, knockback);

    this.hitstop(TUNING.hurtFx.hitstopMs, player, source);
    this.fx.shake(TUNING.hurtFx.shake, player);
    this.fx.hurtFlash(player);

    if (player.hp <= 0) {
      sfx.death(player);
      this.killPlayer(player);
    } else {
      sfx.hurt(player);
      this.fx.flash(player, 90);
    }
    return true;
  }

  // The run ends when the last player falls.
  killPlayer(player) {
    player.die();
    this.fx.bloodBurst(player.x, player.y, player.y + TUNING.player.radius);
    if (this.livingPlayers().length === 0) this.gameOver();
  }

  // Freezes just these sprites (nulls are skipped) for `ms`; everything else carries on.
  // An enemy's stun waits out the freeze, so one you just hit is still harmless when it thaws.
  hitstop(ms, ...sprites) {
    const now = this.time.now;
    const until = now + ms;
    for (const sprite of sprites) {
      if (!sprite) continue;
      const added = until - Math.max(sprite.frozenUntil ?? 0, now);
      if (added > 0 && this.enemies.contains(sprite) && sprite.stunUntil > now) sprite.stunUntil += added;
      freeze(sprite, until);
      this.frozen.add(sprite);
    }
  }

  // `now` is this frame's time: in 'preupdate' the scene clock still reads the last frame's.
  thawFrozen(now) {
    if (this.isOver) return;
    for (const sprite of this.frozen) {
      if (sprite.active && isFrozen(sprite, now)) continue;
      if (sprite.active) thaw(sprite);
      this.frozen.delete(sprite);
    }
  }

  // With the mouse and a screen of your own (solo, or online), the camera leans toward where you aim.
  // On a shared screen it stays on the middle.
  updateCameraLookahead() {
    const own = this.link || this.players.length === 1 ? this.players[0] : null;
    leanCamera(this.cameras.main, this.lookahead, own?.alive ? own.controls.pointer ?? null : null);
  }

  updateHud(now) {
    this.hud.update(now, this.hudData(now));
  }

  hudData(now) {
    return {
      players: this.players.map((p) => ({ hp: p.hp, resource: p.kit.hudValue })),
      kills: this.kills,
      secs: Math.floor((now - this.startedAt) / 1000),
      muted: sfx.muted,
      boss: this.boss?.hudInfo ?? null,
    };
  }


  gameOver() {
    this.isOver = true;
    this.overAt = this.time.now;
    this.updateHud(this.time.now);
    this.spawner.stop();
    this.physics.world.pause();

    this.overStats = { kills: this.kills, secs: Math.floor((this.overAt - this.startedAt) / 1000) };
    this.hud.showGameOver(this.overStats);
  }

  tryRestart() {
    if (this.time.now - this.overAt > 500) this.scene.restart({ devices: this.devices, classes: this.classes, link: this.link });
  }
}
