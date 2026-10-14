import Phaser from 'phaser';
import { TUNING } from '../tuning.js';
import { COLORS, createTextures } from '../textures.js';
import { Player } from '../entities/Player.js';
import { Enemy } from '../entities/Enemy.js';
import { Spawner } from '../systems/Spawner.js';
import { Fx } from '../fx.js';

const M = TUNING.melee;

export class GameScene extends Phaser.Scene {
  constructor() {
    super('game');
  }

  create() {
    createTextures(this);
    const { width: W, height: H } = TUNING.world;

    this.physics.world.setBounds(0, 0, W, H);
    this.add.tileSprite(0, 0, W, H, 'grid').setOrigin(0);
    this.add.graphics().lineStyle(4, COLORS.border).strokeRect(0, 0, W, H);

    this.player = new Player(this, W / 2, H / 2);
    this.enemies = this.physics.add.group();
    this.physics.add.collider(this.enemies, this.enemies);
    this.physics.add.overlap(this.player, this.enemies, (_p, enemy) => this.onPlayerTouched(enemy));

    const cam = this.cameras.main;
    cam.setBounds(0, 0, W, H);
    cam.startFollow(this.player, true, TUNING.camera.followLerp, TUNING.camera.followLerp);
    this.lookahead = new Phaser.Math.Vector2();

    this.fx = new Fx(this);
    this.spawner = new Spawner(this, (x, y) => this.spawnEnemy(x, y));

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.input.mouse.disableContextMenu();
    this.attackQueuedAt = -Infinity;
    this.input.on('pointerdown', () => {
      if (this.isOver) this.tryRestart();
      else this.attackQueuedAt = this.time.now;
    });
    this.input.keyboard.on('keydown-R', () => this.isOver && this.tryRestart());

    this.hitstopUntil = 0;
    this.kills = 0;
    this.startedAt = this.time.now;
    this.isOver = false;

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
    this.player.move(this.readMoveInput(), dt, now);
    this.tryAttack(now);

    for (const enemy of this.enemies.getChildren()) {
      if (!enemy.dying) enemy.chase(this.player, dt, now);
    }

    this.player.syncVisuals(now);
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

  tryAttack(now) {
    if (now - this.attackQueuedAt > M.bufferMs || now < this.player.nextAttackAt) return;
    this.attackQueuedAt = -Infinity;

    const p = this.player;
    p.nextAttackAt = now + M.cooldownMs;
    this.fx.slash(p, p.aimAngle, M.range, M.arcDeg);
    p.body.velocity.add(new Phaser.Math.Vector2().setToPolar(p.aimAngle, M.lungeSpeed));

    const er = TUNING.enemy.radius;
    const halfArc = Phaser.Math.DegToRad(M.arcDeg) / 2;
    let hits = 0;
    let kills = 0;

    for (const enemy of [...this.enemies.getChildren()]) {
      if (enemy.dying) continue;
      const dx = enemy.x - p.x;
      const dy = enemy.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist > M.range + er) continue;
      const touching = dist < TUNING.player.radius + er + 6;
      const offAngle = Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - p.aimAngle));
      if (!touching && offAngle > halfArc) continue;

      hits++;
      const dir = dist > 0.01 ? new Phaser.Math.Vector2(dx / dist, dy / dist) : new Phaser.Math.Vector2().setToPolar(p.aimAngle);
      this.fx.hitSparks(enemy.x - dir.x * er, enemy.y - dir.y * er);
      if (enemy.takeHit(M.damage, dir, M.knockback, now)) {
        kills++;
        this.killEnemy(enemy);
      } else {
        this.fx.flash(enemy);
        this.fx.squash(enemy);
      }
    }

    if (hits > 0) {
      this.hitstop(kills > 0 ? M.killHitstopMs : M.hitstopMs);
      this.fx.shake(M.shake);
    }
  }

  killEnemy(enemy) {
    this.kills++;
    this.fx.deathBurst(enemy.x, enemy.y);
    enemy.die();
  }

  spawnEnemy(x, y) {
    const enemy = new Enemy(this, x, y);
    this.enemies.add(enemy);
    enemy.setupBody();
  }

  onPlayerTouched(enemy) {
    const now = this.time.now;
    if (this.isOver || this.player.isInvulnerable(now) || !enemy.canHurt(now)) return;

    const dir = new Phaser.Math.Vector2(this.player.x - enemy.x, this.player.y - enemy.y).normalize();
    this.player.hurt(TUNING.enemy.contactDamage, dir, now);
    enemy.knock(dir.clone().negate(), TUNING.player.hurtKnockback * 0.6, now);

    this.hitstop(TUNING.hurtFx.hitstopMs);
    this.fx.shake(TUNING.hurtFx.shake);
    this.cameras.main.flash(120, 120, 20, 40);

    if (this.player.hp <= 0) this.gameOver();
    else this.fx.flash(this.player, 90);
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
    this.hud.setText(`HP ${'●'.repeat(hp)}${'○'.repeat(max - hp)}   Kills ${this.kills}   ${time}`);
  }

  gameOver() {
    this.isOver = true;
    this.overAt = this.time.now;
    this.updateHud(this.time.now);
    this.spawner.stop();
    this.physics.world.pause();
    this.player.setAlpha(1).setTint(0x555566);
    this.player.aimMarker.setVisible(false);

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
