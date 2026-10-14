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

  melee: {
    cooldownMs: 260,
    bufferMs: 160,        // a click this early before cooldown ends still counts
    range: 72,
    arcDeg: 120,
    damage: 1,
    knockback: 560,
    lungeSpeed: 170,      // small forward push on swing
    hitstopMs: 50,        // freeze when the swing connects
    killHitstopMs: 80,
    shake: { duration: 90, intensity: 0.004 },
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
