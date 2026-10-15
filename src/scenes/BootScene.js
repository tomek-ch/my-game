import Phaser from 'phaser';
import { createTextures } from '../textures.js';
import { preloadArt, registerArt } from '../art.js';
import { registerPixelFont } from '../ui/pixelFont.js';

// Loads and builds every texture once, then shows the start screen.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload() {
    preloadArt(this);
  }

  create() {
    registerArt(this);
    createTextures(this);
    registerPixelFont(this);
    this.scene.start('start');
  }
}
