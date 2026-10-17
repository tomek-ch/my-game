import { TUNING } from '../tuning.js';

const C = TUNING.classes;

// The movement ability of each class that an online guest predicts for its own player (see Prediction),
// so it starts when the button is pressed rather than a round trip later.
//   press    the Controls press that starts it
//   kind     'dash' (Player.dash with cfg's distance, durationMs, exitSpeed) or 'blink' (a jump to the
//            aim, at most cfg.range away)
//   angle    for a dash: 'move' goes where you're moving (where you aim when standing), 'aim' where you aim
//   cooldown ms from the start until it can be used again, if that's fixed; null if it depends on how it
//            went (a berserker strike that hits is ready again almost at once)
//   cost     resource it spends (the HUD's value), if any
// And for the host to report (see GameScene.abilityState): when it's ready again (readyAt) and whether
// something else the class is doing rules it out (busy).
export const PREDICTED_ABILITIES = {
  knight: {
    press: 'dashQueuedAt', kind: 'dash', angle: 'move', cfg: C.knight.dash,
    cooldown: C.knight.dash.durationMs + C.knight.dash.cooldownMs,
    readyAt: (p) => p.nextDashAt,
    busy: (p) => p.isDashing,
  },
  berserker: {
    press: 'attackQueuedAt', kind: 'dash', angle: 'aim', cfg: C.berserker.strike,
    cooldown: null,
    readyAt: (p) => p.nextDashAt,
    busy: (p) => p.isDashing || !!p.kit.leap,
  },
  mage: {
    press: 'dashQueuedAt', kind: 'blink', cfg: C.mage.blink,
    cooldown: C.mage.blink.cooldownMs,
    cost: C.mage.blink.cost,
    readyAt: (p) => p.kit.nextBlinkAt,
    busy: () => false,
  },
};
