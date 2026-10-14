import Phaser from 'phaser';
import { createTextures } from '../textures.js';

// Loads and builds every texture once, then hands over to the game.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create() {
    createTextures(this);
    this.scene.start('game');
  }
}
