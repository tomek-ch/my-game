import Phaser from 'phaser';

const STICK_DEADZONE = 0.25;
const AIM_DEADZONE = 0.4;
// Standard mapping: A, B, X, Y, LB, RB, RT. Everything you do while aiming is on the right shoulder, so
// the right thumb never leaves the stick: melee RB, shot LB, dash RT (or A).
export const PAD = { dash: [0, 7], back: 1, view: 2, melee: 5, shoot: 4, triggers: [6, 7] };
const TRIGGER_THRESHOLD = 0.5; // Phaser counts a press only at 1.0, a full pull that some triggers never reach

// What one player wants to do this frame. The game only reads this, never a device, so a player can
// be driven by the mouse and keyboard, a gamepad, or a remote peer.
// A device is named 'kbm' (keyboard and mouse) or by a gamepad's index.
export class Controls {
  constructor() {
    this.move = new Phaser.Math.Vector2(); // normalized, or zero
    this.aimAngle = null;                  // radians, or null to keep the current aim
    this.aimPoint = null;                  // world point aimed at, if the device has one (a mouse)
    this.aimReach = null;                  // 0..1 how far a stick is tilted past the deadzone, or null
    // When each button was last pressed, so presses can be buffered for a moment.
    this.attackQueuedAt = -Infinity;
    this.shootQueuedAt = -Infinity;
    this.dashQueuedAt = -Infinity;
    this.attackHeld = false; // whether the attack button is down right now, for auto-fire
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

    this.attackHeld = this.pointer.leftButtonDown();
    const aim = this.scene.cameras.main.getWorldPoint(this.pointer.x, this.pointer.y);
    this.aimPoint = aim;
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
    this.attackHeld = !!pad?.buttons[PAD.melee]?.pressed;
    const stick = pad?.leftStick;
    if (stick && stick.length() > STICK_DEADZONE) this.move.copy(stick).limit(1);
    else this.move.set(0, 0);

    const aim = pad?.rightStick;
    this.aimReach = null;
    if (aim && aim.length() > AIM_DEADZONE) {
      this.aimAngle = aim.angle();
      this.aimReach = Math.min((aim.length() - AIM_DEADZONE) / (1 - AIM_DEADZONE), 1);
    } else if (this.move.lengthSq() > 0) this.aimAngle = this.move.angle();
    else this.aimAngle = null;
  }
}

// The buffered presses, by their Controls field; these names go over the wire.
export const PRESSES = ['attackQueuedAt', 'shootQueuedAt', 'dashQueuedAt'];

// A player on another machine: the guest reads its own device and sends what it reads over `link`
// (see GuestScene). Presses are stamped with this scene's clock as they arrive. A mouse's aim comes
// as the world point aimed at, so the angle is worked out here from where the player is now.
export class RemoteControls extends Controls {
  constructor(scene, link) {
    super();
    this.view = null;
    this.inputAt = null;
    const onInput = (msg) => {
      this.move.set(msg.move[0], msg.move[1]);
      this.aimAngle = msg.aimAngle;
      this.aimPoint = msg.aimPoint && { x: msg.aimPoint[0], y: msg.aimPoint[1] };
      this.aimReach = msg.aimReach;
      this.attackHeld = msg.attackHeld;
      this.view = msg.view; // the guest camera's scroll, [x, y], for spawning out of their sight
      this.inputAt = msg.at; // when the guest sent it, by its clock: the host echoes it (see Prediction)
    };
    const onPress = (msg) => {
      if (PRESSES.includes(msg.button)) this[msg.button] = scene.time.now;
    };
    const onClose = () => {
      this.move.set(0, 0);
      this.attackHeld = false;
    };
    link.on('input', onInput).on('press', onPress).on('close', onClose);
    scene.events.once('shutdown', () => link.off('input', onInput).off('press', onPress).off('close', onClose));
  }

  update(player) {
    if (this.aimPoint) this.aimAngle = Math.atan2(this.aimPoint.y - player.y, this.aimPoint.x - player.x);
  }
}

// The guest's side of RemoteControls: what `controls` read this frame, as an 'input' message.
// `view` is the guest camera's scroll, `at` the guest's clock (performance.now()).
export function inputMessage(controls, view, at) {
  const round = (v) => Math.round(v * 100) / 100;
  const { move, aimAngle, aimPoint, aimReach } = controls;
  return {
    t: 'input',
    move: [round(move.x), round(move.y)],
    aimAngle: aimAngle === null ? null : round(aimAngle),
    aimPoint: aimPoint ? [Math.round(aimPoint.x), Math.round(aimPoint.y)] : null,
    aimReach: aimReach === null ? null : round(aimReach),
    attackHeld: controls.attackHeld,
    view: [Math.round(view.x), Math.round(view.y)],
    at: Math.round(at * 10) / 10,
  };
}

// device: 'kbm', a gamepad index, or 'remote' for the guest in an online game (needs `link`).
export function createControls(scene, device, link) {
  if (device === 'remote') return new RemoteControls(scene, link);
  return device === 'kbm' ? new MouseKeyboardControls(scene) : new GamepadControls(scene, device);
}
