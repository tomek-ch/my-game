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
import { BOLT_TINT } from '../textures.js';
import { MouseKeyboardControls, PadOrKeysControls } from '../input/controls.js';

const M = TUNING.melee;
const D = TUNING.dash;
const R = TUNING.ranged;
const HEROES = ['knight_m', 'knight_f'];
const MAX_PLAYERS = 2;
const LEASH_MARGIN = 40; // co-op players can't walk further apart than the screen, minus this

export class GameScene extends Phaser.Scene {
  constructor() {
    super('game');
  }

  // data.players: how many local players (1 or 2). Player 2 uses a gamepad or the arrow keys.
  init(data) {
    this.playerCount = Phaser.Math.Clamp(data?.players ?? 1, 1, MAX_PLAYERS);
  }

  create() {
    const { width: W, height: H } = TUNING.world;

    this.physics.world.setBounds(0, 0, W, H);
    const art = addDungeon(this, W, H);

    const coop = this.playerCount > 1;
    this.players = [];
    for (let i = 0; i < this.playerCount; i++) {
      const controls = i === 0 ? new MouseKeyboardControls(this, { arrows: !coop }) : new PadOrKeysControls(this, i - 1);
      const x = W / 2 + (i - (this.playerCount - 1) / 2) * 60;
      this.players.push(new Player(this, x, H / 2, { hero: HEROES[i], controls }));
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
    this.input.gamepad?.on('down', () => this.isOver && this.tryRestart());

    this.hitstopUntil = 0;
    this.kills = 0;
    this.startedAt = this.time.now;
    this.isOver = false;

    // Arcade copies body positions onto sprites after update(), so anything placed relative to a
    // sprite is synced here; doing it in update() drew it a frame behind.
    this.events.on('postupdate', this.syncVisuals, this);
    this.events.once('shutdown', () => this.events.off('postupdate', this.syncVisuals, this));

    this.hud = new Hud(this, TUNING.player.maxHp, this.playerCount);
  }

  update(_time, delta) {
    if (this.isOver) return;
    const now = this.time.now;

    // Hitstop: everything freezes for a few frames when a hit lands.
    if (now < this.hitstopUntil) return;
    if (this.physics.world.isPaused) this.physics.world.resume();

    const dt = Math.min(delta, 50) / 1000;
    for (const p of this.livingPlayers()) {
      const c = p.controls;
      c.update(p);
      if (c.aimAngle !== null) p.aimAngle = c.aimAngle;
      this.tryDash(p, now);
      p.move(c.move, dt, now);
      this.tryAttack(p, now);
      this.tryShoot(p, now);
      this.updateDashFx(p, now);
    }
    this.updateProjectiles(this.bolts);
    this.updateProjectiles(this.enemyBullets);

    for (const enemy of this.enemies.getChildren()) {
      if (this.isOver) break; // the last player can fall to an enemy earlier in this loop
      if (enemy.dying) continue;
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

  // Dash where you're moving, or where you're aiming when standing still.
  tryDash(p, now) {
    const c = p.controls;
    if (now - c.dashQueuedAt > D.bufferMs || !p.canDash(now)) return;
    c.dashQueuedAt = -Infinity;
    const angle = c.move.lengthSq() > 0 ? c.move.angle() : p.aimAngle;
    p.dash(angle, now);
    this.fx.dashStart(p, angle);
    sfx.dash();
    p.dashWasReady = false;
  }

  updateDashFx(p, now) {
    if (p.isDashing && now >= p.nextGhostAt) {
      this.fx.afterimage(p);
      p.nextGhostAt = now + D.ghostIntervalMs;
    }
    const ready = !p.isDashing && now >= p.nextDashAt;
    if (ready && !p.dashWasReady) {
      this.fx.readyRing(p, TUNING.player.radius);
      sfx.dashReady();
    }
    p.dashWasReady = ready;
  }

  tryAttack(p, now) {
    // Clicks during a dash stay buffered and fire as it ends.
    if (p.isDashing) return;
    const c = p.controls;
    if (now - c.attackQueuedAt > M.bufferMs || now < p.nextAttackAt) return;
    c.attackQueuedAt = -Infinity;

    if (now > p.comboExpiresAt) p.comboIndex = 0;
    const swing = M.swings[p.comboIndex];
    const isFinisher = p.comboIndex === M.swings.length - 1;
    p.nextAttackAt = now + swing.recoveryMs + (isFinisher ? M.comboCooldownMs : 0);
    p.comboExpiresAt = now + swing.recoveryMs + M.comboWindowMs;
    p.comboIndex = isFinisher ? 0 : p.comboIndex + 1;

    // Aim assist: step toward the nearest enemy roughly in front, and bend the swing toward it.
    const target = this.findSwingTarget(p, swing);
    let angle = p.aimAngle;
    let stepDist = swing.step;
    if (target) {
      angle = target.angle;
      const gap = TUNING.player.radius + target.enemy.radius + M.stepGap;
      stepDist = Phaser.Math.Clamp(target.dist - gap, 0, swing.maxStep);
    }
    p.step(angle, stepDist, M.stepMs);
    this.fx.slash(p, angle, swing);
    p.swingSword(angle, swing, now);
    sfx.swing(swing.finisher);

    // Resolve hits from where the step ends, so the swing lands where it's drawn.
    const ox = p.x + Math.cos(angle) * stepDist;
    const oy = p.y + Math.sin(angle) * stepDist;
    const halfArc = Phaser.Math.DegToRad(swing.arcDeg) / 2;
    let hits = 0;
    let kills = 0;

    const inSwing = (x, y, radius) => {
      const dist = Phaser.Math.Distance.Between(ox, oy, x, y);
      if (dist > swing.range + radius) return false;
      if (dist < TUNING.player.radius + radius + 6) return true;
      return Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(y - oy, x - ox) - angle)) <= halfArc;
    };

    // Swings delete enemy bullets.
    for (const bullet of [...this.enemyBullets.getChildren()]) {
      if (!inSwing(bullet.x, bullet.y, 7)) continue;
      this.fx.hitSparks(bullet.x, bullet.y);
      sfx.deflect(bullet.x, bullet.y);
      bullet.destroy();
    }

    for (const enemy of [...this.enemies.getChildren()]) {
      if (enemy.dying || !inSwing(enemy.x, enemy.y, enemy.radius)) continue;

      hits++;
      const dir = new Phaser.Math.Vector2(enemy.x - ox, enemy.y - oy);
      if (dir.lengthSq() < 0.01) dir.setToPolar(angle);
      dir.normalize();
      this.fx.hitSparks(enemy.x - dir.x * enemy.radius, enemy.y - dir.y * enemy.radius);
      const hit = { damage: swing.damage, dir, knockback: swing.knockback, heavy: swing.finisher };
      if (enemy.takeHit(hit, now)) {
        kills++;
        this.killEnemy(enemy);
      } else {
        this.fx.flash(enemy);
        this.fx.squash(enemy, swing.finisher ? 0.45 : 0.3);
      }
    }

    if (hits > kills) sfx.hit(swing.finisher);
    if (hits > 0) {
      this.hitstop(swing.hitstopMs + (kills > 0 ? M.killHitstopBonusMs : 0));
      this.fx.shake(swing.shake);
    }
    this.gainPips(p, hits * R.hitPips);
  }

  gainPips(p, pips) {
    const before = Math.floor(p.pips / R.pipsPerCharge);
    p.pips = Math.min(p.pips + pips, R.maxCharges * R.pipsPerCharge);
    if (Math.floor(p.pips / R.pipsPerCharge) > before) {
      this.fx.readyRing(p, TUNING.player.radius, BOLT_TINT);
      sfx.shotReady();
    }
  }

  // Fire (right click) shoots one charged bolt, exactly where you aim. No charge, no shot.
  tryShoot(p, now) {
    const c = p.controls;
    if (p.isDashing || now < p.nextShotAt || now - c.shootQueuedAt > R.bufferMs) return;
    c.shootQueuedAt = -Infinity;
    if (p.pips < R.pipsPerCharge) {
      sfx.shotEmpty();
      this.hud.shakeCharges(this.players.indexOf(p));
      return;
    }
    p.pips -= R.pipsPerCharge;
    p.nextShotAt = now + R.cooldownMs;

    const angle = p.aimAngle;
    const muzzle = TUNING.player.radius + 12;
    const x = p.x + Math.cos(angle) * muzzle;
    const y = p.y + Math.sin(angle) * muzzle;

    // Configure after create(): the group resets body settings when it adopts a child.
    const bolt = this.bolts.create(x, y, 'bolt').setScale(ART_SCALE);
    bolt.body.setCircle(4.5, 2.5, 0); // art pixels: radius 9 on screen, centered (the body doesn't rotate)
    bolt.trailTint = BOLT_TINT;
    bolt.trailCount = 3;
    bolt.setVelocity(Math.cos(angle) * R.speed, Math.sin(angle) * R.speed);
    bolt.setRotation(angle).setDepth(12).setBlendMode(Phaser.BlendModes.ADD);
    bolt.startX = x;
    bolt.startY = y;
    bolt.maxRange = R.range;
    bolt.pierced = new Set();

    p.body.velocity.add(new Phaser.Math.Vector2().setToPolar(angle, -R.recoil));
    sfx.shoot();
    this.fx.hitSparks(x, y);
    this.fx.shake(R.shake);
  }

  // Projectiles fizzle out at their max range or the world edge.
  updateProjectiles(group) {
    const { width: W, height: H } = TUNING.world;
    for (const shot of [...group.getChildren()]) {
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
  onBoltHit(bolt, enemy) {
    if (!bolt.active || enemy.dying || bolt.pierced.has(enemy)) return;
    const now = this.time.now;
    const damage = R.damage + R.pierceBonus * bolt.pierced.size;
    bolt.pierced.add(enemy);
    const dir = bolt.body.velocity.clone().normalize();
    this.fx.hitSparks(enemy.x - dir.x * enemy.radius, enemy.y - dir.y * enemy.radius);
    this.fx.shake(R.hitShake);
    if (enemy.takeHit({ damage, dir, knockback: R.knockback, stunMs: R.stunMs, heavy: true }, now)) {
      this.killEnemy(enemy);
      this.hitstop(R.killHitstopMs);
    } else {
      sfx.boltHit(enemy.x, enemy.y);
      this.fx.flash(enemy);
      this.fx.squash(enemy, 0.4);
      this.hitstop(R.hitstopMs);
    }
  }

  // Nearest live enemy within reach (range + assist distance) and within assistDeg of the aim.
  findSwingTarget(p, swing) {
    const reach = swing.range + M.assistRange;
    const cone = Phaser.Math.DegToRad(M.assistDeg);
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
      this.fx.hitSparks(enemy.x - dir.x * enemy.radius, enemy.y - dir.y * enemy.radius);
      if (enemy.takeHit({ damage, dir, knockback, stunMs, heavy: true }, now)) {
        this.killEnemy(enemy);
      } else {
        this.fx.flash(enemy);
        this.fx.squash(enemy, 0.3);
      }
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
    for (const p of this.livingPlayers()) p.syncVisuals(this.time.now);
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
    if (this.damagePlayer(player, contact.damage, dir, contact.knockback)) {
      enemy.knock(dir.clone().negate(), TUNING.player.hurtKnockback * 0.6, this.time.now);
    }
  }

  // Returns false if the player couldn't be hurt right now.
  damagePlayer(player, damage, dir, knockback) {
    const now = this.time.now;
    if (this.isOver || !player.alive || player.isInvulnerable(now)) return false;
    player.hurt(damage, dir, now, knockback);

    this.hitstop(TUNING.hurtFx.hitstopMs);
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

  hitstop(ms) {
    this.hitstopUntil = Math.max(this.hitstopUntil, this.time.now + ms);
    this.physics.world.pause();
  }

  // Solo with the mouse, the camera leans toward where you aim. In co-op it stays on the middle.
  updateCameraLookahead() {
    const C = TUNING.camera;
    const cam = this.cameras.main;
    const pointer = this.players.length === 1 ? this.players[0].controls.pointer : null;
    const tx = pointer ? -(pointer.x - cam.width / 2) * C.aimLookahead : 0;
    const ty = pointer ? -(pointer.y - cam.height / 2) * C.aimLookahead : 0;
    this.lookahead.x += (tx - this.lookahead.x) * C.lookaheadLerp;
    this.lookahead.y += (ty - this.lookahead.y) * C.lookaheadLerp;
    cam.setFollowOffset(this.lookahead.x, this.lookahead.y);
  }

  updateHud(now) {
    this.hud.update(now, {
      players: this.players.map((p) => ({ hp: p.hp, pips: p.pips })),
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
    if (this.time.now - this.overAt > 500) this.scene.restart({ players: this.playerCount });
  }
}
