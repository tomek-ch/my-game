import { Knight } from './Knight.js';
import { Berserker } from './Berserker.js';
import { Mage } from './Mage.js';

// Every playable class by id, in the start screen's order.
export const CLASSES = { knight: Knight, berserker: Berserker, mage: Mage };
export const CLASS_IDS = Object.keys(CLASSES);
