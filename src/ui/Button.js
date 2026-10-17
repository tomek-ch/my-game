import { pixelText } from './pixelFont.js';

const SCALE = 3; // screen pixels per font pixel for the label
const PAD_X = 28; // space either side of the label
const MIN_WIDTH = 220;
const HEIGHT = 56;
const FILL = 0x1a1016;
const FILL_FOCUSED = 0x2e1f2a;
const EDGE = 0x5a4a5e;

// A clickable box with a pixel-font label, fixed to the screen. It lights up in `color` while focused;
// the owner decides what focus means, told by `onHover` when the mouse moves over it. `onPress(device)`
// runs on a left click, with 'kbm' as the device, and whenever the owner calls press().
export class Button {
  constructor(scene, label, { color, onPress, onHover }) {
    this.color = color;
    this.onPress = onPress;
    this.text = pixelText(scene, 0, 0, label, SCALE).setOrigin(0.5);
    this.width = Math.max(MIN_WIDTH, this.text.width + PAD_X * 2);
    this.bg = scene.add.rectangle(0, 0, this.width, HEIGHT, FILL, 0.9).setScrollFactor(0);
    this.bg.setInteractive({ useHandCursor: true });
    this.text.setDepth(1);
    this.bg.on('pointerover', () => onHover?.());
    this.bg.on('pointerdown', (pointer) => pointer.button === 0 && this.press('kbm'));
    this.setFocused(false);
  }

  press(device) {
    this.onPress(device);
  }

  setFocused(focused) {
    this.focused = focused;
    this.bg.setFillStyle(focused ? FILL_FOCUSED : FILL, 0.9).setStrokeStyle(3, focused ? this.color : EDGE);
    if (focused) this.text.setTint(this.color);
    else this.text.clearTint();
    return this;
  }

  // Centred on (x, y).
  setPosition(x, y) {
    this.bg.setPosition(x, y);
    this.text.setPosition(x, y);
    return this;
  }

  setVisible(visible) {
    this.bg.setVisible(visible);
    this.text.setVisible(visible);
    if (visible) this.bg.setInteractive();
    else this.bg.disableInteractive();
    return this;
  }
}
