import { Enemy } from './Enemy.js';
import { Charger } from './Charger.js';
import { Shooter } from './Shooter.js';
import { Brute } from './Brute.js';
import { Warden } from './Warden.js';

class Grunt extends Enemy {
  constructor(scene, x, y) {
    super(scene, x, y, 'grunt');
  }
}

export const ENEMY_TYPES = { grunt: Grunt, charger: Charger, shooter: Shooter, brute: Brute, warden: Warden };
