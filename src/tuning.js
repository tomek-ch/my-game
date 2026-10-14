// All the numbers that decide how the game feels. Speeds are px/s, accelerations px/s², times ms.

export const TUNING = {
  world: { width: 2400, height: 2400 },

  camera: {
    followLerp: 0.12,     // lower = lazier camera
    aimLookahead: 0.18,   // how far the camera leans toward the mouse (fraction of cursor offset)
    lookaheadLerp: 0.08,
  },

  player: {
    radius: 14,
    maxSpeed: 260,
    accel: 2200,          // speeding up while a key is held
    decel: 2800,          // slowing down after keys are released
    turnAccel: 4200,      // used when pushing against current velocity, makes reversing snappy
    maxHp: 5,
    invulnMs: 900,        // after taking damage
    hurtKnockback: 460,
    hurtStunMs: 140,      // input ignored briefly after getting hit
    stunFriction: 9,      // how fast knockback bleeds off (exponential, per second)
  },

  dash: {
    distance: 150,
    durationMs: 130,
    cooldownMs: 550,      // counted from the end of the dash
    bufferMs: 120,
    invulnGraceMs: 60,    // stay untouchable this long after the dash ends
    exitSpeed: 260,       // speed you come out of the dash with (player maxSpeed = seamless run)
    ghostIntervalMs: 18,  // afterimage spacing
  },

  melee: {
    bufferMs: 180,        // a click this early before the next swing is allowed still counts
    comboWindowMs: 450,   // after a swing's recovery, how long you have to continue the chain
    comboCooldownMs: 380, // extra wait after the finisher
    assistRange: 60,      // look this far past swing range for an enemy to step toward
    assistDeg: 35,        // swing bends toward that enemy if it's within this angle of the mouse
    stepMs: 70,           // duration of the forward step on each swing
    stepGap: 6,           // the step stops this far short of touching the target
    killHitstopBonusMs: 25,

    // One entry per hit of the combo. sweep: 1 / -1 is which way the slash is drawn.
    swings: [
      {
        damage: 1, range: 72, arcDeg: 115, knockback: 230, recoveryMs: 190,
        step: 12, maxStep: 50, hitstopMs: 45, sweep: 1, finisher: false,
        shake: { duration: 70, intensity: 0.003 },
      },
      {
        damage: 1, range: 72, arcDeg: 115, knockback: 230, recoveryMs: 190,
        step: 12, maxStep: 50, hitstopMs: 45, sweep: -1, finisher: false,
        shake: { duration: 70, intensity: 0.003 },
      },
      {
        damage: 2, range: 88, arcDeg: 170, knockback: 680, recoveryMs: 240,
        step: 20, maxStep: 70, hitstopMs: 90, sweep: 1, finisher: true,
        shake: { duration: 140, intensity: 0.009 },
      },
    ],
  },

  enemy: {
    radius: 13,
    hp: 3,
    maxSpeed: 115,
    accel: 650,
    stunMs: 240,          // no steering after being hit, so knockback reads clearly
    knockbackFriction: 7,
    contactDamage: 1,
    spawnGraceMs: 300,    // can't hurt you right as it pops in
  },

  spawn: {
    startIntervalMs: 1300,
    minIntervalMs: 320,
    rampSeconds: 120,     // time to go from start to min interval
    maxAlive: 70,
    offscreenMargin: 60,
  },

  hurtFx: {
    hitstopMs: 90,
    shake: { duration: 180, intensity: 0.012 },
  },
};
