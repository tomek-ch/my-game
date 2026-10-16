import Phaser from 'phaser';

const STICK_DEADZONE = 0.25;
const AIM_DEADZONE = 0.4;
// Standard mapping: A, B, X, Y, LB, RB, RT. Everything you do while aiming is on the right shoulder, so
// the right thumb never leaves the stick: melee RB, shot LB, dash RT (or A).
export const PAD = { dash: [0, 7], back: 1, view: 2, coop: 3, melee: 5, shoot: 4, triggers: [6, 7] };
const TRIGGER_THRESHOLD = 0.5; // Phaser counts a press only at 1.0, a full pull that some triggers never reach

// What one player wants to do this frame. The game only reads this, never a device, so a player can
// be driven by the mouse and keyboard, a gamepad, or (later) a remote peer.
// A device is named 'kbm' (keyboard and mouse) or by a gamepad's index.
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

// WASD or the arrows to move, the mouse to aim and attack.
export class MouseKeyboardControls extends Controls {
  constructor(scene) {
    super();
    this.scene = scene;
    this.keys = scene.input.keyboard.addKeys('W,A,S,D');
    this.cursors = scene.input.keyboard.createCursorKeys();
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
    const held = (key, arrow) => key.isDown || c[arrow].isDown;
    this.move.set(
      (held(k.D, 'right') ? 1 : 0) - (held(k.A, 'left') ? 1 : 0),
      (held(k.S, 'down') ? 1 : 0) - (held(k.W, 'up') ? 1 : 0),
    ).normalize();

    const aim = this.scene.cameras.main.getWorldPoint(this.pointer.x, this.pointer.y);
    this.aimAngle = Math.atan2(aim.y - player.y, aim.x - player.x);
  }
}

// One gamepad: left stick to move, right stick to aim (or where you last moved), RT or A dash,
// RB melee, LB fire.
export class GamepadControls extends Controls {
  constructor(scene, padIndex) {
    super();
    this.scene = scene;
    this.padIndex = padIndex;
    scene.input.gamepad.on('down', (pad, button) => {
      if (pad.index !== this.padIndex) return;
      const now = scene.time.now;
      if (PAD.dash.includes(button.index)) this.dashQueuedAt = now;
      else if (button.index === PAD.melee) this.attackQueuedAt = now;
      else if (button.index === PAD.shoot) this.shootQueuedAt = now;
    });
  }

  get pad() {
    const pad = this.scene.input.gamepad.getPad(this.padIndex);
    return pad?.connected ? pad : null;
  }

  update() {
    const pad = this.pad;
    // Pads are created per scene with the default threshold; this is the first chance to set it.
    for (const i of PAD.triggers) if (pad?.buttons[i]) pad.buttons[i].threshold = TRIGGER_THRESHOLD;
    const stick = pad?.leftStick;
    if (stick && stick.length() > STICK_DEADZONE) this.move.copy(stick).limit(1);
    else this.move.set(0, 0);

    const aim = pad?.rightStick;
    if (aim && aim.length() > AIM_DEADZONE) this.aimAngle = aim.angle();
    else if (this.move.lengthSq() > 0) this.aimAngle = this.move.angle();
    else this.aimAngle = null;
  }
}

export function createControls(scene, device) {
  return device === 'kbm' ? new MouseKeyboardControls(scene) : new GamepadControls(scene, device);
}
