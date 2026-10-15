import { ART_SCALE } from '../art.js';
import { shadowTexture } from '../textures.js';

export const SHADOW_DEPTH = 2; // above floor and blood, below characters
const ALPHA = 0.32;

// An oval shadow under a character's feet (the bottom of its hit circle). Call sync() whenever the
// owner moves; it's destroyed along with the owner.
export class Shadow {
  constructor(owner, widthArtPx, radius) {
    this.owner = owner;
    this.radius = radius;
    this.image = owner.scene.add.image(owner.x, owner.y, shadowTexture(owner.scene, widthArtPx))
      .setScale(ART_SCALE)
      .setAlpha(ALPHA)
      .setDepth(SHADOW_DEPTH);
    owner.once('destroy', () => this.image.destroy());
    this.sync();
  }

  sync() {
    this.image.setPosition(this.owner.x, this.owner.y + this.radius - ART_SCALE);
  }

  fadeOut(duration) {
    this.owner.scene.tweens.add({ targets: this.image, alpha: 0, duration });
  }

  fadeIn(duration) {
    this.image.setAlpha(0);
    this.owner.scene.tweens.add({ targets: this.image, alpha: ALPHA, duration });
  }
}
