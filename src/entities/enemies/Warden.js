import Phaser from 'phaser';
import { TUNING } from '../../tuning.js';
import { Brute } from './Brute.js';
import { sfx } from '../../audio/sfx.js';
import { ART_SCALE, ENEMY_ART } from '../../art.js';
import { pixelDisk, pixelLine, pixelRing, pixelSector } from '../../pixelShapes.js';
import { AIR_DEPTH } from '../depth.js';

const TAU = Math.PI * 2;
const LUNGE_SECS = 0.1;
const CROUCH_SQUASH = 0.18;
const DANGER = 0xff3040;
const CHAIN_DEPTH = 10;   // above the characters, below anything in the air
const CHAIN_TRAIL = 1.1;  // radians of fading blur behind the whirling chain
const DAZE_STARS = 3;

// Boss: a brute grown huge. Arrives with summonWarden() at a set time, then fights alongside the waves.
// Up close: the brute's swing. Mid range: chainWindup (its reach fills in on the floor) -> chainSweep
// (one turn, two when enraged) -> recover. Far: the brute's leap, and every slam sends shockwave rings.
// Hits don't stagger it; they wear down its poise (heavy hits more), and with none left it's broken:
// stunned and taking extra damage, then back to full poise. Below enraged.belowHp it's faster.
export class Warden extends Brute {
  constructor(scene, x, y) {
    super(scene, x, y, 'warden');
    this.baseScale = ART_SCALE * this.cfg.scale;
    this.setScale(this.baseScale);
    this.bar.setVisible(false); // the HUD shows its health
    this.poise = this.cfg.poise.max;
    this.lastHitAt = -Infinity;
    this.enraged = false;
    this.cooldowns = { swing: 0, chain: this.cfg.chain.firstCooldownMs / 1000, leap: 0 };
    this.recoverMs = 0;
    this.chain = null; // { angle, dir, swept, turn, hit }
    this.rings = [];   // { x, y, r, delay, hit }
    this.ringGfx = scene.add.graphics().setDepth(4);
    this.chainGfx = scene.add.graphics().setDepth(CHAIN_DEPTH);
    this.dazeGfx = scene.add.graphics().setDepth(30);
    this.on('destroy', () => [this.ringGfx, this.chainGfx, this.dazeGfx].forEach((g) => g.destroy()));
  }

  // It drops in rather than popping up (see summonWarden).
  popIn() {}

  get pace() {
    return this.enraged ? this.cfg.enraged.windupScale : 1;
  }

  // For the HUD's boss bar: health, and poise or, while broken, how much of the opening is left.
  get hudInfo() {
    const P = this.cfg.poise;
    const broken = this.mode === 'broken';
    return {
      hp: Math.max(this.hp, 0) / this.cfg.hp,
      poise: broken ? 1 - this.stateT * 1000 / P.brokenMs : this.poise / P.max,
      broken,
      enraged: this.enraged,
    };
  }

  tick(dt, now) {
    this.updateRings(dt);
    super.tick(dt, now);
  }

  think(player, dt, now) {
    const { attack: a, jump: j, chain: c } = this.cfg;
    for (const key in this.cooldowns) this.cooldowns[key] -= dt;
    this.regenPoise(dt, now);
    if (!this.enraged && this.hp <= this.cfg.hp * this.cfg.enraged.belowHp) this.enrage();

    if (this.mode === 'chase') {
      this.chase(player, dt);
    } else if (this.mode === 'windup') {
      this.brake(dt);
      this.facing = this.aim;
      const progress = this.stateT * 1000 / (a.windupMs * this.pace);
      this.drawArea(Math.min(progress, 1));
      if (progress >= 1) {
        this.recoverMs = a.recoveryMs;
        this.swing();
      }
    } else if (this.mode === 'recover') {
      if (this.stateT >= LUNGE_SECS) this.body.velocity.set(0, 0);
      if (this.stateT * 1000 >= this.recoverMs) this.enter('chase');
    } else if (this.mode === 'chainWindup') {
      this.brake(dt);
      const progress = this.stateT * 1000 / (c.windupMs * this.pace);
      this.drawChainWarning(Math.min(progress, 1));
      if (progress >= 1) this.startWhirl();
    } else if (this.mode === 'chainSweep') {
      this.brake(dt);
      this.whirl(dt);
    } else if (this.mode === 'crouch') {
      this.brake(dt);
      this.aimLanding(player);
      this.facing = this.angleTo(this.landing);
      const crouchMs = j.crouchMs * this.pace;
      const progress = Math.min(this.stateT * 1000 / crouchMs, 1);
      this.setScale(this.baseScale * (1 + CROUCH_SQUASH * progress), this.baseScale * (1 - CROUCH_SQUASH * progress));
      this.drawLanding(progress * crouchMs / (crouchMs + j.airMs));
      if (progress >= 1) this.takeOff();
    } else if (this.mode === 'air') {
      const airSecs = j.airMs / 1000;
      const t = Math.min(this.stateT / airSecs, 1);
      this.setLift(j.height * 4 * t * (1 - t));
      const left = Math.max(airSecs - this.stateT, dt);
      this.body.velocity.set((this.landing.x - this.x) / left, (this.landing.y - this.y) / left);
      const crouchMs = j.crouchMs * this.pace;
      this.drawLanding((crouchMs + this.stateT * 1000) / (crouchMs + j.airMs));
      if (t >= 1) this.slam();
    } else if (this.mode === 'landed') {
      this.body.velocity.set(0, 0);
      if (this.stateT * 1000 >= j.recoverMs) this.enter('chase');
    } else if (this.mode === 'broken') {
      this.brake(dt);
      if (this.stateT * 1000 >= this.cfg.poise.brokenMs) this.recoverFromBreak();
    }
  }

  // Walk at the target and pick an attack by how far away it is: swing up close, chain at mid range, leap
  // from further out.
  chase(player, dt) {
    const { attack: a, jump: j, chain: c } = this.cfg;
    const speed = this.cfg.maxSpeed * (this.enraged ? this.cfg.enraged.speedScale : 1);
    this.steer(player.x - this.x, player.y - this.y, speed, dt);
    this.faceVelocity();

    const gap = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y) - TUNING.player.radius;
    const cd = this.cooldowns;
    if (gap <= a.triggerRange && cd.swing <= 0) {
      this.aim = this.angleTo(player);
      const windupMs = a.windupMs * this.pace;
      cd.swing = (windupMs + a.recoveryMs + a.cooldownMs) / 1000;
      this.enter('windup');
      this.windupSound = sfx.bruteWindup(this.x, this.y, windupMs / 1000);
    } else if (gap <= c.triggerRange && cd.chain <= 0) {
      cd.chain = c.cooldownMs / 1000;
      // Starts behind itself, so whoever it's aimed at has half a turn to react.
      this.chain = { angle: this.angleTo(player) + Math.PI, dir: Math.random() < 0.5 ? -1 : 1, swept: 0, turn: 0, hit: new Set() };
      this.enter('chainWindup');
      this.windupSound = sfx.wardenChainWindup(this.x, this.y, c.windupMs * this.pace / 1000);
    } else if (gap >= j.minRange && gap <= j.maxRange && cd.leap <= 0) {
      cd.leap = (j.crouchMs * this.pace + j.airMs + j.recoverMs + j.cooldownMs) / 1000;
      this.enter('crouch');
      this.windupSound = sfx.bruteWindup(this.x, this.y, j.crouchMs * this.pace / 1000);
    }
  }

  // ---- Chain ---------------------------------------------------------------------------------

  startWhirl() {
    const c = this.cfg.chain;
    this.windupSound = null;
    this.clearTelegraph();
    this.enter('chainSweep');
    const turns = this.enraged ? c.enragedTurns : c.turns;
    sfx.wardenChainWhirl(this.x, this.y, turns * c.sweepMs / 1000);
  }

  // Turn the chain by this frame's share and hit whatever it passed over; a new turn can hit everyone again.
  whirl(dt) {
    const c = this.cfg.chain;
    const chain = this.chain;
    const total = (this.enraged ? c.enragedTurns : c.turns) * TAU;
    const step = Math.min(TAU / (c.sweepMs / 1000) * dt, total - chain.swept);
    const from = chain.angle;
    chain.angle += step * chain.dir;
    chain.swept += step;
    this.facing = chain.angle;
    const turn = Math.floor(chain.swept / TAU);
    if (turn !== chain.turn) {
      chain.turn = turn;
      chain.hit.clear();
    }
    this.chainHits(from, step);
    this.drawChain();

    if (chain.swept >= total) {
      this.chainGfx.clear();
      this.clearTelegraph(); // the blur behind the chain
      this.chain = null;
      this.recoverMs = c.recoveryMs;
      this.enter('recover');
    }
  }

  // Did the chain, turning `span` radians from angle `from`, pass over a circle at (x, y)?
  sweptOver(from, span, x, y, radius) {
    const c = this.cfg.chain;
    const dist = Phaser.Math.Distance.Between(this.x, this.y, x, y);
    if (dist > c.reach + radius) return false;
    const half = dist > radius ? Math.asin(radius / dist) : Math.PI;
    const rel = (((Math.atan2(y - this.y, x - this.x) - from) * this.chain.dir) % TAU + TAU) % TAU;
    return rel <= span + half || rel >= TAU - half;
  }

  chainHits(from, span) {
    const c = this.cfg.chain;
    const { hit, dir: spin } = this.chain;
    const scene = this.scene;
    // Knocked along the way the chain is going, and out.
    const knockDir = (x, y) => {
      const out = new Phaser.Math.Vector2(x - this.x, y - this.y).normalize();
      return new Phaser.Math.Vector2(-out.y * spin, out.x * spin).add(out).normalize();
    };
    let landed = false;
    for (const player of scene.livingPlayers()) {
      if (hit.has(player) || !this.sweptOver(from, span, player.x, player.y, TUNING.player.radius)) continue;
      hit.add(player);
      if (scene.damagePlayer(player, c.damage, knockDir(player.x, player.y), c.knockback, this)) landed = true;
    }
    scene.hitEnemies(this, this.x, this.y, (e) => {
      if (hit.has(e) || !this.sweptOver(from, span, e.x, e.y, e.radius)) return false;
      hit.add(e);
      landed = true;
      return true;
    }, this.cfg.friendlyFire);
    if (landed) scene.fx.shake(c.shake);
  }

  // The floor it's about to sweep, filling in, with the chain resting where it'll start and the rim lit
  // just ahead of it to show which way it'll turn.
  drawChainWarning(progress) {
    const c = this.cfg.chain;
    const { angle, dir } = this.chain;
    const g = this.telegraph();
    g.fillStyle(DANGER, 0.12);
    pixelRing(g, this.x, this.y, 0, c.reach - ART_SCALE);
    g.fillStyle(DANGER, 0.5);
    pixelRing(g, this.x, this.y, c.reach - ART_SCALE, c.reach);
    g.fillStyle(DANGER, 0.15 + progress * 0.25);
    pixelRing(g, this.x, this.y, 0, c.reach * progress);
    g.fillStyle(DANGER, 0.9);
    pixelSector(g, this.x, this.y, c.reach - ART_SCALE * 3, c.reach, angle, dir * 0.7);
    const blink = progress > 0.6 && Math.floor(this.stateT * 1000 / 70) % 2 === 0;
    this.drawChainAt(angle, blink ? 0xffffff : null);
  }

  // The chain mid-whirl, with a fading blur over the floor it just swept.
  drawChain() {
    const c = this.cfg.chain;
    const { angle, dir } = this.chain;
    const g = this.telegraph();
    g.fillStyle(this.cfg.color, 0.12);
    pixelSector(g, this.x, this.y, this.radius, c.reach, angle - dir * CHAIN_TRAIL, dir * CHAIN_TRAIL * 0.4);
    g.fillStyle(this.cfg.color, 0.25);
    pixelSector(g, this.x, this.y, this.radius, c.reach, angle - dir * CHAIN_TRAIL * 0.6, dir * CHAIN_TRAIL * 0.6);
    this.drawChainAt(angle);
  }

  // Links from the warden's side out to an iron ball at the end of its reach.
  drawChainAt(angle, tint = null) {
    const c = this.cfg.chain;
    const g = this.chainGfx.clear();
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const ball = c.reach - c.ballRadius;
    for (let d = this.radius * 0.6; d < ball - c.ballRadius; d += 10) {
      g.fillStyle(tint ?? 0x6b7078);
      pixelDisk(g, this.x + ux * d, this.y + uy * d, 4);
      g.fillStyle(tint ?? 0xb7bcc4);
      pixelDisk(g, this.x + ux * d, this.y + uy * d, 2);
    }
    const bx = this.x + ux * ball;
    const by = this.y + uy * ball;
    g.fillStyle(tint ?? 0x3d4148);
    pixelDisk(g, bx, by, c.ballRadius);
    g.fillStyle(tint ?? 0x8a9099);
    pixelDisk(g, bx - c.ballRadius * 0.3, by - c.ballRadius * 0.3, c.ballRadius * 0.45);
    // Spikes around the ball.
    g.fillStyle(tint ?? 0x3d4148);
    for (let i = 0; i < 6; i++) {
      const a = angle + i * TAU / 6;
      pixelLine(g, bx, by, bx + Math.cos(a) * (c.ballRadius + 6), by + Math.sin(a) * (c.ballRadius + 6), 4);
    }
  }

  // ---- Slam and rings -------------------------------------------------------------------------

  slam() {
    super.slam();
    this.scene.fx.shake(this.cfg.jump.shake);
    const R = this.cfg.rings;
    const count = this.enraged ? R.enragedCount : R.count;
    for (let i = 0; i < count; i++) {
      this.rings.push({ x: this.x, y: this.y, r: this.radius, delay: i * R.gapMs / 1000, hit: new Set(), dustLeft: 0 });
    }
  }

  // Rings race outward from where they were made. A player is checked once, when the ring first reaches
  // them: untouchable then (dashing, blinking, leaping, just hurt) and it passes harmlessly.
  updateRings(dt) {
    const R = this.cfg.rings;
    const scene = this.scene;
    const g = this.ringGfx.clear();
    for (const ring of this.rings) {
      if (ring.delay > 0) {
        ring.delay -= dt;
        // The slam's own thud covers the first ring; later ones get a thud of their own.
        if (ring.delay <= 0) sfx.bruteSlam(ring.x, ring.y);
        continue;
      }
      ring.r += R.speed * dt;
      if (ring.r >= R.maxRadius) continue; // spent: dropped below, not drawn (its fade would be negative)
      for (const player of scene.livingPlayers()) {
        if (ring.hit.has(player)) continue;
        const dist = Phaser.Math.Distance.Between(ring.x, ring.y, player.x, player.y);
        const pr = TUNING.player.radius;
        if (dist + pr < ring.r - R.width || dist - pr > ring.r) continue;
        ring.hit.add(player);
        const dir = new Phaser.Math.Vector2(player.x - ring.x, player.y - ring.y);
        if (dir.lengthSq() < 0.01) dir.setToPolar(Math.random() * TAU);
        scene.damagePlayer(player, R.damage, dir.normalize(), R.knockback);
      }
      this.drawRing(g, ring, dt);
    }
    this.rings = this.rings.filter((ring) => ring.r < R.maxRadius);
  }

  // A solid red wave with a soft glow trailing behind it and a hot front edge that flickers, kicking up
  // dust as it goes. Full strength for most of its travel, fading over the last third.
  drawRing(g, ring, dt) {
    const R = this.cfg.rings;
    const t = ring.r / R.maxRadius;
    const fade = t < 2 / 3 ? 1 : 1 - (t - 2 / 3) * 3;
    const inner = ring.r - R.width;
    const edge = ring.r - R.edgeWidth;
    g.fillStyle(DANGER, 0.18 * fade);
    pixelRing(g, ring.x, ring.y, Math.max(inner - R.glowWidth, 0), inner);
    g.fillStyle(DANGER, 0.75 * fade);
    pixelRing(g, ring.x, ring.y, inner, edge);
    const flicker = Math.floor(this.scene.time.now / 60) % 2 === 0;
    g.fillStyle(flicker ? 0xffffff : 0xffb0b0, fade);
    pixelRing(g, ring.x, ring.y, edge, ring.r);

    ring.dustLeft -= dt;
    if (ring.dustLeft > 0 || fade < 0.3) return;
    ring.dustLeft = R.dustEveryMs / 1000;
    for (let i = 0; i < R.dustPerPuff; i++) {
      const a = Math.random() * TAU;
      this.scene.fx.sparks.explode(2, ring.x + Math.cos(a) * ring.r, ring.y + Math.sin(a) * ring.r);
    }
  }

  // ---- Poise and phases -----------------------------------------------------------------------

  takeHit(hit, now) {
    const P = this.cfg.poise;
    const scale = this.mode === 'broken' ? P.brokenDamageMultiplier : 1;
    return super.takeHit({ ...hit, damage: hit.damage * scale }, now);
  }

  // Never knocked about or stunned; hits only nudge it and wear down its poise.
  onHit(hit, now) {
    if (this.airborne || this.mode === 'broken') return;
    this.body.velocity.add(hit.dir.clone().scale(hit.knockback * 0.05));
    this.lastHitAt = now;
    this.poise -= hit.damage * (hit.heavy ? this.cfg.poise.heavyMultiplier : 1);
    if (this.poise <= 0) this.breakPoise();
  }

  regenPoise(dt, now) {
    const P = this.cfg.poise;
    if (this.mode === 'broken' || now - this.lastHitAt < P.regenDelayMs) return;
    this.poise = Math.min(P.max, this.poise + P.regenPerSec * dt);
  }

  // Out of poise: whatever it was doing is cut off and it's stunned, open to punishment.
  breakPoise() {
    this.poise = 0;
    this.stopWindupSound();
    this.clearTelegraph();
    this.chainGfx.clear();
    this.chain = null;
    this.setScale(this.baseScale);
    this.enter('broken');
    sfx.wardenBreak(this.x, this.y);
    this.scene.fx.shake({ duration: 160, intensity: 0.01 });
    this.scene.fx.squash(this, 0.3, 220);
  }

  recoverFromBreak() {
    this.poise = this.cfg.poise.max;
    this.dazeGfx.clear();
    const cd = this.cooldowns;
    cd.swing = Math.max(cd.swing, 0.4);
    cd.leap = Math.max(cd.leap, 0.8);
    this.enter('chase');
  }

  enrage() {
    this.enraged = true;
    sfx.wardenRoar(this.x, this.y);
    this.scene.fx.shake({ duration: 300, intensity: 0.012 });
    this.scene.fx.flash(this, 160);
  }

  // ---- Visuals --------------------------------------------------------------------------------

  syncVisuals() {
    super.syncVisuals();
    const g = this.dazeGfx.clear();
    if (this.mode !== 'broken') return;
    // Stars circling over its head while it's stunned.
    const now = this.scene.time.now;
    this.anims.timeScale = 0.4;
    g.fillStyle(0xffe08a);
    for (let i = 0; i < DAZE_STARS; i++) {
      const a = now / 260 + i * TAU / DAZE_STARS;
      const x = this.x + Math.cos(a) * this.radius * 0.8;
      const y = this.top - 6 + Math.sin(a) * 6;
      g.fillRect(Math.round(x / ART_SCALE) * ART_SCALE - ART_SCALE, Math.round(y / ART_SCALE) * ART_SCALE, ART_SCALE * 3, ART_SCALE);
      g.fillRect(Math.round(x / ART_SCALE) * ART_SCALE, Math.round(y / ART_SCALE) * ART_SCALE - ART_SCALE, ART_SCALE, ART_SCALE * 3);
    }
  }

  die() {
    this.rings = [];
    this.ringGfx.clear();
    this.chainGfx.clear();
    this.dazeGfx.clear();
    const scene = this.scene;
    scene.fx.shake({ duration: 500, intensity: 0.02 });
    for (let i = 0; i < 4; i++) {
      const a = i * TAU / 4 + Math.random();
      scene.fx.bloodBurst(this.x + Math.cos(a) * this.radius * 0.6, this.y + Math.sin(a) * this.radius * 0.4, this.y + this.radius, 2);
    }
    sfx.wardenRoar(this.x, this.y);
    super.die();
    scene.wardenSlain(this);
  }
}

// Announces the warden and marks where it'll land near the players, then drops it in with a slam.
// Returns the landing spot.
export function summonWarden(scene) {
  const cfg = TUNING.enemies.warden;
  const A = cfg.arrival;
  const { width: W, height: H } = TUNING.world;
  const margin = cfg.radius + 20;
  const angle = Math.random() * TAU;
  const x = Phaser.Math.Clamp(scene.focus.x + Math.cos(angle) * A.distance, margin, W - margin);
  const y = Phaser.Math.Clamp(scene.focus.y + Math.sin(angle) * A.distance, margin, H - margin);
  const radius = cfg.jump.radius;

  sfx.wardenRoar(x, y);
  scene.fx.shake({ duration: A.warnMs, intensity: 0.003 });
  scene.hud.announceBoss('The Warden');

  // The landing circle fills in over the warning, the same look as the brute's leap.
  const g = scene.add.graphics().setDepth(4);
  let falling = null;
  const startedAt = scene.time.now;
  const draw = () => {
    if (scene.isOver) return;
    const t = Math.min((scene.time.now - startedAt) / A.warnMs, 1);
    g.clear();
    g.fillStyle(DANGER, 0.12);
    pixelRing(g, x, y, 0, radius - ART_SCALE);
    g.fillStyle(DANGER, 0.5);
    pixelRing(g, x, y, radius - ART_SCALE, radius);
    g.fillStyle(DANGER, 0.15 + t * 0.25);
    pixelRing(g, x, y, 0, radius * t);
    // Falling into view for the last part, from above the top of the screen.
    const fallT = 1 - (A.warnMs - (scene.time.now - startedAt)) / A.dropMs;
    if (fallT > 0) {
      const { monster, center } = ENEMY_ART.warden;
      falling ??= scene.add.sprite(x, y, 'dungeon', `${monster}_idle_anim_f0`).setScale(ART_SCALE * cfg.scale).setDepth(AIR_DEPTH);
      falling.setOrigin(center.x / falling.width, center.y / falling.height);
      falling.y = y - (1 - Math.min(fallT, 1) ** 2) * scene.cameras.main.height;
    }
  };
  // Scene events outlive a restart, so a run restarted mid-warning has to drop the listener too.
  const stop = () => scene.events.off('postupdate', draw);
  scene.events.on('postupdate', draw);
  scene.events.once('shutdown', stop);
  scene.time.delayedCall(A.warnMs, () => {
    stop();
    scene.events.off('shutdown', stop);
    g.destroy();
    falling?.destroy();
    if (scene.isOver) return;
    const warden = scene.spawnEnemy(x, y, 'warden');
    warden.slam();
  });
  return { x, y };
}
