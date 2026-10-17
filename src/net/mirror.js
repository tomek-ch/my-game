import Phaser from 'phaser';
import { shadowTexture } from '../textures.js';
import { packCommands, unpackCommands } from './packCommands.js';

// Online co-op shows the guest the host's game by copying what's on screen rather than the game state.
// Each snapshot lists the host's world objects in display order: images and sprites as their texture,
// frame and transform, graphics as their command buffer (the shapes they draw, packed small, see
// packCommands.js). The guest rebuilds them as plain images and graphics with no logic of their own.
//
// Not copied: the dungeon (both sides build the same one), anything fixed to the screen (the HUD, which
// the guest draws from the host's HUD data instead), particles and render textures (blood stains).
//
// Entries are arrays to keep snapshots small:
//   image:    ['i', id, texture, frame, x, y, scaleX, scaleY, originX, originY, rotation, flags, alpha, depth, tint, blendMode, glows?]
//   graphics: ['g', id, x, y, scaleX, scaleY, rotation, flags, alpha, depth, blendMode, commands]
// flags: bit 0 visible, 1 flipX, 2 flipY, 3 tint fill. A graphics' commands are sent only when they
// changed since the last snapshot (null otherwise), which is safe because the link is ordered and
// reliable. glows, only on an image with glow effects (the berserker's rage): [padding, [color,
// outerStrength, innerStrength, knockout]...]. Other shader effects aren't copied.

const VISIBLE = 1;
const FLIP_X = 2;
const FLIP_Y = 4;
const TINT_FILL = 8;

// Where the smoothly changing fields sit in an entry, for blending between snapshots.
const BLENDED = {
  i: { x: 4, y: 5, sx: 6, sy: 7, rotation: 10, alpha: 12 },
  g: { x: 2, y: 3, sx: 4, sy: 5, rotation: 6, alpha: 8 },
};
const SNAP_DISTANCE = 100; // px between snapshots past which something jumped (a blink) rather than moved

const r1 = (v) => Math.round(v * 10) / 10;
const lerp = (a, b, t) => a + (b - a) * t;
// The short way round, so an angle going past ±π doesn't spin the long way.
const lerpAngle = (a, b, t) => a + Phaser.Math.Angle.Wrap(b - a) * t;
const r3 = (v) => Math.round(v * 1000) / 1000;

const flagsOf = (o) => (o.visible ? VISIBLE : 0) | (o.flipX ? FLIP_X : 0) | (o.flipY ? FLIP_Y : 0) | (o.tintFill ? TINT_FILL : 0);

export class MirrorSender {
  // Create right after the dungeon is added: everything already in the scene is left out.
  constructor(scene) {
    this.scene = scene;
    this.skip = new Set(scene.children.list);
    this.ids = new WeakMap();
    this.nextId = 1;
    this.sentCommands = new WeakMap(); // graphics -> JSON of the packed commands last sent
  }

  idOf(o) {
    let id = this.ids.get(o);
    if (!id) this.ids.set(o, (id = this.nextId++));
    return id;
  }

  capture() {
    const out = [];
    for (const o of this.scene.children.list) {
      if (this.skip.has(o) || o.scrollFactorX === 0) continue;
      // By class, not `type`: enemies use `type` for their own kind.
      if (o instanceof Phaser.GameObjects.Image || o instanceof Phaser.GameObjects.Sprite) out.push(this.image(o));
      else if (o instanceof Phaser.GameObjects.Graphics) out.push(this.graphics(o));
    }
    return out;
  }

  image(o) {
    const entry = [
      'i', this.idOf(o), o.texture.key, o.frame.name, r1(o.x), r1(o.y), r3(o.scaleX), r3(o.scaleY),
      r3(o.originX), r3(o.originY), r3(o.rotation), flagsOf(o), r3(o.alpha), r1(o.depth), o.tintTopLeft, o.blendMode,
    ];
    const glows = o.preFX?.list.filter((fx) => fx instanceof Phaser.FX.Glow) ?? [];
    if (glows.length) {
      entry.push([o.preFX.padding, ...glows.map((g) => [g.color, r3(g.outerStrength), r3(g.innerStrength), g.knockout ? 1 : 0])]);
    }
    return entry;
  }

  graphics(o) {
    const packed = packCommands(o.commandBuffer);
    const json = JSON.stringify(packed);
    const changed = this.sentCommands.get(o) !== json;
    if (changed) this.sentCommands.set(o, json);
    return [
      'g', this.idOf(o), r1(o.x), r1(o.y), r3(o.scaleX), r3(o.scaleY), r3(o.rotation), flagsOf(o),
      r3(o.alpha), r1(o.depth), o.blendMode, changed ? packed : null,
    ];
  }
}

export class MirrorReceiver {
  constructor(scene) {
    this.scene = scene;
    this.objects = new Map(); // id -> game object
    this.entries = new Map(); // id -> its entry in the last snapshot applied
  }

  apply(entries) {
    const seen = new Set();
    for (const e of entries) {
      const id = e[1];
      seen.add(id);
      let o = this.objects.get(id);
      if (!o) {
        o = e[0] === 'g' ? this.scene.add.graphics() : this.scene.add.image(0, 0, '__DEFAULT');
        this.objects.set(id, o);
      }
      if (e[0] === 'g') this.applyGraphics(o, e);
      else this.applyImage(o, e);
      this.entries.set(id, e);
      this.scene.children.bringToTop(o); // keep the host's order among equal depths
    }
    for (const [id, o] of this.objects) {
      if (seen.has(id)) continue;
      o.destroy();
      this.objects.delete(id);
      this.entries.delete(id);
    }
  }

  // Eases each object from where the last applied snapshot put it toward where `next` (the snapshot
  // after it, not applied yet) has it, t from 0 to 1. Only position, scale, rotation and alpha move
  // smoothly; everything else changes when `next` is applied.
  blend(next, t) {
    for (const e of next) {
      const from = this.entries.get(e[1]);
      const o = this.objects.get(e[1]);
      if (!from || !o || from[0] !== e[0]) continue;
      const f = BLENDED[e[0]];
      if (Math.hypot(e[f.x] - from[f.x], e[f.y] - from[f.y]) > SNAP_DISTANCE) continue;
      o.setPosition(lerp(from[f.x], e[f.x], t), lerp(from[f.y], e[f.y], t));
      o.setScale(lerp(from[f.sx], e[f.sx], t), lerp(from[f.sy], e[f.sy], t));
      o.setRotation(lerpAngle(from[f.rotation], e[f.rotation], t));
      o.setAlpha(lerp(from[f.alpha], e[f.alpha], t));
    }
  }

  applyImage(o, [, , texture, frame, x, y, sx, sy, ox, oy, rotation, flags, alpha, depth, tint, blend, glows]) {
    if (!this.scene.textures.exists(texture)) {
      const shadow = texture.match(/^shadow-(\d+)$/);
      if (shadow) shadowTexture(this.scene, Number(shadow[1]));
    }
    if (o.texture.key !== texture || o.frame.name !== frame) o.setTexture(texture, frame);
    o.setPosition(x, y).setScale(sx, sy).setOrigin(ox, oy).setRotation(rotation);
    o.setVisible(!!(flags & VISIBLE)).setFlip(!!(flags & FLIP_X), !!(flags & FLIP_Y));
    if (flags & TINT_FILL) o.setTintFill(tint);
    else o.setTint(tint);
    o.setAlpha(alpha).setDepth(depth).setBlendMode(blend);
    this.applyGlows(o, glows);
  }

  // Shader effects need WebGL; with the canvas renderer there's no preFX and no glow, as on the host.
  applyGlows(o, glows) {
    const fx = o.preFX;
    if (!fx) return;
    if (!glows) {
      if (fx.list.length) fx.clear();
      return;
    }
    const [padding, ...list] = glows;
    if (fx.list.length !== list.length) {
      fx.clear();
      for (let i = 0; i < list.length; i++) fx.addGlow();
    }
    fx.setPadding(padding);
    list.forEach(([color, outerStrength, innerStrength, knockout], i) => {
      Object.assign(fx.list[i], { color, outerStrength, innerStrength, knockout: !!knockout });
    });
  }

  applyGraphics(o, [, , x, y, sx, sy, rotation, flags, alpha, depth, blend, commands]) {
    if (commands) o.commandBuffer = unpackCommands(commands);
    o.setPosition(x, y).setScale(sx, sy).setRotation(rotation).setVisible(!!(flags & VISIBLE));
    o.setAlpha(alpha).setDepth(depth).setBlendMode(blend);
  }

  // Shows the objects `ids` as `entries` (a newer snapshot's than the one applied) has them, but placed
  // relative to (x, y) as they were to (fromX, fromY) there: our own player, drawn from the newest
  // snapshot at the predicted spot, while everything else plays back from an older one.
  showAhead(entries, ids, fromX, fromY, x, y) {
    for (const id of ids) {
      const o = this.objects.get(id);
      const e = entries.find((entry) => entry[1] === id);
      if (!o || !e || e[0] !== 'i') continue;
      this.applyImage(o, e);
      o.setPosition(x + e[BLENDED.i.x] - fromX, y + e[BLENDED.i.y] - fromY);
    }
  }

  clear() {
    for (const o of this.objects.values()) o.destroy();
    this.objects.clear();
    this.entries.clear();
  }
}
