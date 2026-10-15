import Phaser from 'phaser';

const STICK_DEADZONE = 0.25;
const AIM_DEADZONE = 0.4;
const PAD = { dash: 0, melee: 2, shoot: [5, 7] }; // A, X, RB/RT (standard mapping)

// What one player wants to do this frame. The game only reads this, never a device, so a player can
// be driven by the mouse and keyboard, a gamepad, or (later) a remote peer.
export class Controls {
  constructor() {
    this.move = new Phaser.Math.Vector2(); // normalized, or zero
    this.aimAngle = null;                  // radians, or null to keep the current aim
    // When each button was last pressed, so presses can be buffered for a moment.
    this.attackQueuedAt = -Infinity;
    this.shootQueuedAt = -Infinity;
    this.dashQueuedAt = -Infinity;
  }

  // Refresh move/aim/held state from the device. `player` is the one these controls drive.
  update(_player) {}
}

// WASD (and the arrows, unless someone else is using them) to move, the mouse to aim and attack.
export class MouseKeyboardControls extends Controls {
  constructor(scene, { arrows = true } = {}) {
    super();
    this.scene = scene;
    this.keys = scene.input.keyboard.addKeys('W,A,S,D');
    this.cursors = arrows ? scene.input.keyboard.createCursorKeys() : null;
    scene.input.mouse.disableContextMenu();
    scene.input.on('pointerdown', (pointer) => {
      if (pointer.button === 2) this.shootQueuedAt = scene.time.now;
      else if (pointer.button === 0) this.attackQueuedAt = scene.time.now;
    });
    const queueDash = (e) => {
      if (!e.repeat) this.dashQueuedAt = scene.time.now;
    };
    scene.input.keyboard.on('keydown-SPACE', queueDash);
    scene.input.keyboard.on('keydown-SHIFT', queueDash);
  }

  get pointer() {
    return this.scene.input.activePointer;
  }

  update(player) {
    const k = this.keys;
    const c = this.cursors;
    const held = (key, arrow) => key.isDown || (c?.[arrow].isDown ?? false);
    this.move.set(
      (held(k.D, 'right') ? 1 : 0) - (held(k.A, 'left') ? 1 : 0),
      (held(k.S, 'down') ? 1 : 0) - (held(k.W, 'up') ? 1 : 0),
    ).normalize();

    const aim = this.scene.cameras.main.getWorldPoint(this.pointer.x, this.pointer.y);
    this.aimAngle = Math.atan2(aim.y - player.y, aim.x - player.x);
  }
}

// A gamepad when one is connected, otherwise the right side of the keyboard: arrows to move,
// , melee, . fire, / dash. Without a right stick, you aim where you last moved.
export class PadOrKeysControls extends Controls {
  constructor(scene, padIndex) {
    super();
    this.scene = scene;
    this.padIndex = padIndex;
    this.cursors = scene.input.keyboard.createCursorKeys();
    this.keys = scene.input.keyboard.addKeys({ melee: 'COMMA', shoot: 'PERIOD', dash: 'FORWARD_SLASH' });
    this.keys.melee.on('down', () => (this.attackQueuedAt = scene.time.now));
    this.keys.shoot.on('down', () => (this.shootQueuedAt = scene.time.now));
    this.keys.dash.on('down', () => (this.dashQueuedAt = scene.time.now));

    scene.input.gamepad?.on('down', (pad, button) => {
      if (pad.index !== this.padIndex) return;
      const now = scene.time.now;
      if (button.index === PAD.dash) this.dashQueuedAt = now;
      else if (button.index === PAD.melee) this.attackQueuedAt = now;
      else if (PAD.shoot.includes(button.index)) this.shootQueuedAt = now;
    });
  }

  get pad() {
    const pad = this.scene.input.gamepad?.getPad(this.padIndex);
    return pad?.connected ? pad : null;
  }

  update() {
    const c = this.cursors;
    const pad = this.pad;
    const stick = pad?.leftStick;
    if (stick && stick.length() > STICK_DEADZONE) {
      this.move.copy(stick).limit(1);
    } else {
      this.move.set(
        (c.right.isDown ? 1 : 0) - (c.left.isDown ? 1 : 0),
        (c.down.isDown ? 1 : 0) - (c.up.isDown ? 1 : 0),
      ).normalize();
    }

    const aim = pad?.rightStick;
    if (aim && aim.length() > AIM_DEADZONE) this.aimAngle = aim.angle();
    else if (this.move.lengthSq() > 0) this.aimAngle = this.move.angle();
    else this.aimAngle = null;
  }
}
