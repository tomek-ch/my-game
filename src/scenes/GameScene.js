import Phaser from 'phaser';
import { TUNING } from '../tuning.js';
import { Player } from '../entities/Player.js';
import { ENEMY_TYPES } from '../entities/enemies/index.js';
import { Spawner } from '../systems/Spawner.js';
import { addDungeon } from '../world/dungeon.js';
import { ART_SCALE } from '../art.js';
import { Hud } from '../ui/Hud.js';
import { Fx } from '../fx.js';
import { sfx } from '../audio/sfx.js';
import { createControls } from '../input/controls.js';
import { freeze, isFrozen, thaw } from '../entities/hitstop.js';
import { CLASSES } from '../classes/index.js';

const MAX_PLAYERS = 2;
const LEASH_MARGIN = 40; // co-op players can't walk further apart than the screen, minus this

export class GameScene extends Phaser.Scene {
  constructor() {
    super('game');
  }

  // data.devices: one input device per local player, 'kbm' or a gamepad index (see controls.js).
  // data.classes: each player's class id (see src/classes/), knight if missing.
  init(data) {
    this.devices = (data?.devices ?? ['kbm']).slice(0, MAX_PLAYERS);
    this.classes = this.devices.map((_, i) => (CLASSES[data?.classes?.[i]] ? data.classes[i] : 'knight'));
    this.playerCount = this.devices.length;
  }

  create() {
    const { width: W, height: H } = TUNING.world;

    this.physics.world.setBounds(0, 0, W, H);
    const art = addDungeon(this, W, H);

    const coop = this.playerCount > 1;
    this.players = [];
    for (let i = 0; i < this.playerCount; i++) {
      const controls = createControls(this, this.devices[i]);
      const x = W / 2 + (i - (this.playerCount - 1) / 2) * 60;
      const Kit = CLASSES[this.classes[i]];
      const player = new Player(this, x, H / 2, { hero: Kit.heroes[i % Kit.heroes.length], weapon: Kit.weapon, controls });
      player.kit = new Kit(this, player);
      this.players.push(player);
    }
    this.enemies = this.physics.add.group();
    // Enemy-vs-enemy contact skips Arcade: its circle separation zeroes both velocities (velocity *
    // bounce, bounce 0) on every touch, even in overlap-only mode, so packed enemies crawled.
    // (The world is rebuilt on restart, so these listeners need no cleanup.)
    this.physics.world.on('worldstep', this.separateEnemies, this);
    if (coop) this.physics.world.on('worldstep', this.leashPlayers, this);
    this.physics.add.overlap(this.players, this.enemies, (player, enemy) => this.onPlayerTouched(player, enemy));
    this.bolts = this.physics.add.group();
    this.physics.add.overlap(this.bolts, this.enemies, (bolt, enemy) => this.onBoltHit(bolt, enemy));
    this.enemyBullets = this.physics.add.group();
    this.physics.add.overlap(this.players, this.enemyBullets, (player, bullet) => this.onEnemyBulletHit(player, bullet));

    // The camera (and the ears) follow the middle of the living players.
    this.focus = new Phaser.Math.Vector2();
    this.updateFocus();
    const cam = this.cameras.main;
    cam.setBounds(art.x, art.y, art.width, art.height); // includes the north wall above the floor
    cam.startFollow(this.focus, true, TUNING.camera.followLerp, TUNING.camera.followLerp);
    this.lookahead = new Phaser.Math.Vector2();

    this.fx = new Fx(this);
    sfx.init(this.sound.context);
    sfx.listener = this.focus;
    this.input.keyboard.on('keydown-M', () => sfx.toggleMute());
    this.spawner = new Spawner(this, (x, y, type) => this.spawnEnemy(x, y, type));

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
    this.events.once('shutdown', () => this.events.off('postupdate', this.syncVisuals, this));

    this.hud = new Hud(this, TUNING.player.maxHp, this.classes.map((id) => CLASSES[id]));
  }

  update(_time, delta) {
    if (this.isOver) return;
    const now = this.time.now;

    this.thawFrozen(now);

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

  // Bolts pierce: each enemy is hit once, and every one already passed through adds damage.
  // bolt.cfg is the shooter's tuning (see TUNING.classes.knight.ranged).
  onBoltHit(bolt, enemy) {
    if (!bolt.active || enemy.dying || bolt.pierced.has(enemy)) return;
    const now = this.time.now;
    const R = bolt.cfg;
    const damage = R.damage + R.pierceBonus * bolt.pierced.size;
    bolt.pierced.add(enemy);
    const dir = bolt.body.velocity.clone().normalize();
    this.fx.shake(R.hitShake);
    if (this.strikeEnemy(enemy, { damage, dir, knockback: R.knockback, stunMs: R.stunMs, heavy: true }, now, 0.4)) {
      this.hitstop(R.killHitstopMs, bolt);
    } else {
      sfx.boltHit(enemy.x, enemy.y);
      this.hitstop(R.hitstopMs, bolt, enemy);
    }
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
    this.updateFocus();
  }

  updateFocus() {
    const living = this.livingPlayers();
    if (living.length === 0) return;
    this.focus.set(0, 0);
    for (const p of living) this.focus.add(p);
    this.focus.scale(1 / living.length);
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
    this.fx.shake(TUNING.hurtFx.shake);
    this.cameras.main.flash(120, 120, 20, 40);

    if (player.hp <= 0) {
      sfx.death();
      this.killPlayer(player);
    } else {
      sfx.hurt();
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
  hitstop(ms, ...sprites) {
    const until = this.time.now + ms;
    for (const sprite of sprites) {
      if (!sprite) continue;
      freeze(sprite, until);
      this.frozen.add(sprite);
    }
  }

  thawFrozen(now) {
    for (const sprite of this.frozen) {
      if (sprite.active && isFrozen(sprite, now)) continue;
      if (sprite.active) thaw(sprite);
      this.frozen.delete(sprite);
    }
  }

  // Solo with the mouse, the camera leans toward where you aim. In co-op it stays on the middle.
  updateCameraLookahead() {
    const C = TUNING.camera;
    const cam = this.cameras.main;
    const pointer = this.players.length === 1 ? this.players[0].controls.pointer ?? null : null;
    const tx = pointer ? -(pointer.x - cam.width / 2) * C.aimLookahead : 0;
    const ty = pointer ? -(pointer.y - cam.height / 2) * C.aimLookahead : 0;
    this.lookahead.x += (tx - this.lookahead.x) * C.lookaheadLerp;
    this.lookahead.y += (ty - this.lookahead.y) * C.lookaheadLerp;
    cam.setFollowOffset(this.lookahead.x, this.lookahead.y);
  }

  updateHud(now) {
    this.hud.update(now, {
      players: this.players.map((p) => ({ hp: p.hp, resource: p.kit.hudValue })),
      kills: this.kills,
      secs: Math.floor((now - this.startedAt) / 1000),
      muted: sfx.muted,
    });
  }


  gameOver() {
    this.isOver = true;
    this.overAt = this.time.now;
    this.updateHud(this.time.now);
    this.spawner.stop();
    this.physics.world.pause();

    this.hud.showGameOver({ kills: this.kills, secs: Math.floor((this.overAt - this.startedAt) / 1000) });
  }

  tryRestart() {
    if (this.time.now - this.overAt > 500) this.scene.restart({ devices: this.devices, classes: this.classes });
  }
}
