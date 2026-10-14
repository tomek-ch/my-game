import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene.js';

// Open with ?debug to see physics bodies.
const debug = new URLSearchParams(location.search).has('debug');

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 720,
  backgroundColor: '#101018',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: { default: 'arcade', arcade: { debug } },
  scene: [GameScene],
});
