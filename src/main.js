import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { StartScene } from './scenes/StartScene.js';
import { GameScene } from './scenes/GameScene.js';

// Open with ?debug to see physics bodies.
const debug = new URLSearchParams(location.search).has('debug');

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 720,
  backgroundColor: '#18141c', // the void around the dungeon
  pixelArt: true,
  roundPixels: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  // Phaser's delta smoothing caps each frame at 1/60 s for 120 frames after startup and after every
  // window focus, and the whole time the window is unfocused. Below 60 fps that ran the game in slow
  // motion (~0.6x at 35 fps). Real deltas are fine: Arcade steps at a fixed 60 Hz and catches up.
  fps: { smoothStep: false },
  physics: { default: 'arcade', arcade: { debug } },
  input: { gamepad: true },
  scene: [BootScene, StartScene, GameScene],
});
