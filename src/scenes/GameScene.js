import Phaser from 'phaser';
import { TUNING } from '../tuning.js';
import { Player } from '../entities/Player.js';
import { ENEMY_TYPES } from '../entities/enemies/index.js';
import { Spawner } from '../systems/Spawner.js';
import { addDungeon } from '../world/dungeon.js';
import { ART_SCALE } from '../art.js';
import { Fx } from '../fx.js';
import { sfx } from '../audio/sfx.js';

const M = TUNING.melee;
const D = TUNING.dash;
const R = TUNING.ranged;

export class GameScene extends Phaser.Scene {
  constructor() {
    super('game');
  }

  create() {
    const { width: W, height: H } = TUNING.world;

    this.physics.world.setBounds(0, 0, W, H);
    const art = addDungeon(this, W, H);

    this.player = new Player(this, W / 2, H / 2);
    this.enemies = this.physics.add.group();
    // Enemy-vs-enemy contact skips Arcade: its circle separation zeroes both velocities (velocity *
    // bounce, bounce 0) on every touch, even in overlap-only mode, so packed enemies crawled.
    // (The world is rebuilt on restart, so this listener needs no cleanup.)
    this.physics.world.on('worldstep', this.separateEnemies, this);
    this.physics.add.overlap(this.player, this.enemies, (_p, enemy) => this.onPlayerTouched(enemy));
    this.bolts = this.physics.add.group();
    this.physics.add.overlap(this.bolts, this.enemies, (bolt, enemy) => this.onBoltHit(bolt, enemy));
    this.enemyBullets = this.physics.add.group();
    this.physics.add.overlap(this.player, this.enemyBullets, (_p, bullet) => this.onEnemyBulletHit(bullet));

    const cam = this.cameras.main;
    cam.setBounds(art.x, art.y, art.width, art.height); // includes the north wall above the floor
    cam.startFollow(this.player, true, TUNING.camera.followLerp, TUNING.camera.followLerp);
    this.lookahead = new Phaser.Math.Vector2();

    this.fx = new Fx(this);
    sfx.init(this.sound.context);
    sfx.listener = this.player;
    this.input.keyboard.on('keydown-M', () => sfx.toggleMute());
    this.spawner = new Spawner(this, (x, y, type) => this.spawnEnemy(x, y, type));

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.input.mouse.disableContextMenu();
    this.attackQueuedAt = -Infinity;
    this.shootQueuedAt = -Infinity;
    this.input.on('pointerdown', (pointer) => {
      if (this.isOver) this.tryRestart();
      else if (pointer.button === 2) this.shootQueuedAt = this.time.now;
      else if (pointer.button === 0) this.attackQueuedAt = this.time.now;
    });
    this.input.keyboard.on('keydown-R', () => this.isOver && this.tryRestart());
    this.dashQueuedAt = -Infinity;
    const queueDash = (e) => {
      if (!e.repeat) this.dashQueuedAt = this.time.now;
    };
    this.input.keyboard.on('keydown-SPACE', queueDash);
    this.input.keyboard.on('keydown-SHIFT', queueDash);
    this.nextGhostAt = 0;
    this.dashWasReady = true;

    this.hitstopUntil = 0;
    this.kills = 0;
    this.startedAt = this.time.now;
    this.isOver = false;

    // Arcade copies body positions onto sprites after update(), so anything placed relative to a
    // sprite is synced here; doing it in update() drew it a frame behind.
    this.events.on('postupdate', this.syncVisuals, this);
    this.events.once('shutdown', () => this.events.off('postupdate', this.syncVisuals, this));

    this.hud = this.add.text(16, 12, '', { fontFamily: 'monospace', fontSize: '20px', color: '#e8e8f0' })
      .setScrollFactor(0)
      .setDepth(100);
  }

  update(_time, delta) {
    if (this.isOver) return;
    const now = this.time.now;

    // Hitstop: everything freezes for a few frames when a hit lands.
    if (now < this.hitstopUntil) return;
    if (this.physics.world.isPaused) this.physics.world.resume();

    const dt = Math.min(delta, 50) / 1000;
    const pointer = this.input.activePointer;
    const aim = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.player.aimAt(aim.x, aim.y);
    const moveDir = this.readMoveInput();
    this.tryDash(now, moveDir);
    this.player.move(moveDir, dt, now);
    this.tryAttack(now);
    this.tryShoot(now, pointer);
    this.updateProjectiles(this.bolts);
    this.updateProjectiles(this.enemyBullets);
    this.updateDashFx(now);

    for (const enemy of this.enemies.getChildren()) {
      if (enemy.dying) continue;
      enemy.tick(this.player, dt, now);
    }

    this.updateCameraLookahead(pointer);
    this.updateHud(now);
  }

  readMoveInput() {
    const c = this.cursors;
    const k = this.wasd;
    const dir = new Phaser.Math.Vector2(
      (c.right.isDown || k.D.isDown ? 1 : 0) - (c.left.isDown || k.A.isDown ? 1 : 0),
      (c.down.isDown || k.S.isDown ? 1 : 0) - (c.up.isDown || k.W.isDown ? 1 : 0),
    );
    return dir.normalize();
  }

  // Dash where you're moving, or toward the mouse when standing still.
  tryDash(now, moveDir) {
    const p = this.player;
    if (now - this.dashQueuedAt > D.bufferMs || !p.canDash(now)) return;
    this.dashQueuedAt = -Infinity;
    const angle = moveDir.lengthSq() > 0 ? moveDir.angle() : p.aimAngle;
    p.dash(angle, now);
    this.fx.dashStart(p, angle);
    sfx.dash();
    this.dashWasReady = false;
  }

  updateDashFx(now) {
    const p = this.player;
    if (p.isDashing && now >= this.nextGhostAt) {
      this.fx.afterimage(p);
      this.nextGhostAt = now + D.ghostIntervalMs;
    }
    const ready = !p.isDashing && now >= p.nextDashAt;
    if (ready && !this.dashWasReady) {
      this.fx.readyRing(p, TUNING.player.radius);
      sfx.dashReady();
    }
    this.dashWasReady = ready;
  }

  tryAttack(now) {
    // Clicks during a dash stay buffered and fire as it ends.
    if (this.player.isDashing) return;
    if (now - this.attackQueuedAt > M.bufferMs || now < this.player.nextAttackAt) return;
    this.attackQueuedAt = -Infinity;

    const p = this.player;
    if (now > p.comboExpiresAt) p.comboIndex = 0;
    const swing = M.swings[p.comboIndex];
    const isFinisher = p.comboIndex === M.swings.length - 1;
    p.nextAttackAt = now + swing.recoveryMs + (isFinisher ? M.comboCooldownMs : 0);
    p.comboExpiresAt = now + swing.recoveryMs + M.comboWindowMs;
    p.comboIndex = isFinisher ? 0 : p.comboIndex + 1;

    // Aim assist: step toward the nearest enemy roughly in front, and bend the swing toward it.
    const target = this.findSwingTarget(swing);
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
  }

  // Right click fires; holding it auto-fires at the cooldown rate.
  tryShoot(now, pointer) {
    const p = this.player;
    if (p.isDashing || now < p.nextShotAt) return;
    if (!pointer.rightButtonDown() && now - this.shootQueuedAt > R.bufferMs) return;
    this.shootQueuedAt = -Infinity;
    p.nextShotAt = now + R.cooldownMs;

    const angle = p.aimAngle + Phaser.Math.DegToRad(Phaser.Math.FloatBetween(-R.spreadDeg, R.spreadDeg));
    const muzzle = TUNING.player.radius + 8;
    const x = p.x + Math.cos(angle) * muzzle;
    const y = p.y + Math.sin(angle) * muzzle;

    // Configure after create(): the group resets body settings when it adopts a child.
    const bolt = this.bolts.create(x, y, 'bolt').setScale(ART_SCALE);
    bolt.body.setSize(4, 4); // art pixels: 8x8 on screen
    bolt.trailTint = 0xffd34d;
    bolt.setVelocity(Math.cos(angle) * R.speed, Math.sin(angle) * R.speed);
    bolt.setRotation(angle).setDepth(12).setBlendMode(Phaser.BlendModes.ADD);
    bolt.startX = x;
    bolt.startY = y;
    bolt.maxRange = R.range;

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
        this.fx.projectileTrail(shot.x, shot.y, shot.trailTint);
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
  onEnemyBulletHit(bullet) {
    if (!bullet.active || this.player.isInvulnerable(this.time.now)) return;
    const dir = bullet.body.velocity.clone().normalize();
    bullet.destroy();
    this.damagePlayer(bullet.damage, dir, bullet.knockback);
  }

  onBoltHit(bolt, enemy) {
    if (!bolt.active || enemy.dying) return;
    const now = this.time.now;
    const dir = bolt.body.velocity.clone().normalize();
    bolt.destroy();
    this.fx.hitSparks(enemy.x - dir.x * enemy.radius, enemy.y - dir.y * enemy.radius);
    if (enemy.takeHit({ damage: R.damage, dir, knockback: R.knockback, stunMs: R.stunMs }, now)) {
      this.killEnemy(enemy);
      this.hitstop(R.killHitstopMs);
    } else {
      sfx.boltHit(enemy.x, enemy.y);
      this.fx.flash(enemy, 50);
      this.fx.squash(enemy, 0.2, 70);
    }
  }

  // Nearest live enemy within reach (range + assist distance) and within assistDeg of the mouse.
  findSwingTarget(swing) {
    const p = this.player;
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
    this.player.syncVisuals(this.time.now);
  }

  // Push overlapping enemies apart, the heavier one moving less. Velocity is left to the AI.
  separateEnemies() {
    const list = this.enemies.getChildren().filter((e) => e.body?.enable);
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

  onPlayerTouched(enemy) {
    const contact = enemy.contact(this.time.now);
    if (!contact) return;
    const dir = new Phaser.Math.Vector2(this.player.x - enemy.x, this.player.y - enemy.y).normalize();
    if (this.damagePlayer(contact.damage, dir, contact.knockback)) {
      enemy.knock(dir.clone().negate(), TUNING.player.hurtKnockback * 0.6, this.time.now);
    }
  }

  // Returns false if the player couldn't be hurt right now.
  damagePlayer(damage, dir, knockback) {
    const now = this.time.now;
    if (this.isOver || this.player.isInvulnerable(now)) return false;
    this.player.hurt(damage, dir, now, knockback);

    this.hitstop(TUNING.hurtFx.hitstopMs);
    this.fx.shake(TUNING.hurtFx.shake);
    this.cameras.main.flash(120, 120, 20, 40);

    if (this.player.hp <= 0) {
      sfx.death();
      this.gameOver();
    } else {
      sfx.hurt();
      this.fx.flash(this.player, 90);
    }
    return true;
  }

  hitstop(ms) {
    this.hitstopUntil = Math.max(this.hitstopUntil, this.time.now + ms);
    this.physics.world.pause();
  }

  updateCameraLookahead(pointer) {
    const C = TUNING.camera;
    const cam = this.cameras.main;
    const tx = -(pointer.x - cam.width / 2) * C.aimLookahead;
    const ty = -(pointer.y - cam.height / 2) * C.aimLookahead;
    this.lookahead.x += (tx - this.lookahead.x) * C.lookaheadLerp;
    this.lookahead.y += (ty - this.lookahead.y) * C.lookaheadLerp;
    cam.setFollowOffset(this.lookahead.x, this.lookahead.y);
  }

  updateHud(now) {
    const max = TUNING.player.maxHp;
    const hp = Math.max(this.player.hp, 0);
    const secs = Math.floor((now - this.startedAt) / 1000);
    const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    const muted = sfx.muted ? '   [M] muted' : '';
    this.hud.setText(`HP ${'●'.repeat(hp)}${'○'.repeat(max - hp)}   Kills ${this.kills}   ${time}${muted}`);
  }

  gameOver() {
    this.isOver = true;
    this.overAt = this.time.now;
    this.updateHud(this.time.now);
    this.spawner.stop();
    this.physics.world.pause();
    this.player.showDead();
    this.fx.bloodBurst(this.player.x, this.player.y, this.player.y + TUNING.player.radius);

    const { width, height } = this.cameras.main;
    this.add.text(width / 2, height / 2, `YOU DIED\n\n${this.kills} kills\n\nclick or press R to restart`, {
      fontFamily: 'monospace',
      fontSize: '28px',
      color: '#ffffff',
      align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100);
  }

  tryRestart() {
    if (this.time.now - this.overAt > 500) this.scene.restart();
  }
}
