import Phaser from 'phaser';
import { createTextures } from '../textures.js';
import { preloadArt, registerArt } from '../art.js';

// Loads and builds every texture once, then hands over to the game.
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
    this.scene.start('game');
  }
}
