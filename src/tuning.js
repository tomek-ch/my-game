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

  ranged: {
    cooldownMs: 240,      // also the auto-fire rate while right button is held
    bufferMs: 120,
    speed: 760,
    range: 520,           // bolt fizzles after travelling this far
    spreadDeg: 3,         // random +/- deviation per shot
    damage: 1,
    knockback: 140,
    stunMs: 110,          // shorter than melee so bolts can't stunlock a crowd
    recoil: 70,           // pushes the player backward a little per shot
    killHitstopMs: 30,
    shake: { duration: 40, intensity: 0.0015 },
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

  // Shared fields: radius, hp, maxSpeed, accel, stunMs (how long a normal hit stuns; stunned enemies
  // don't steer or deal damage), knockbackFriction, contactDamage, mass (for shoving each other), color
  // (used by telegraphs and charge trails).
  enemies: {
    grunt: {
      radius: 13, hp: 3, maxSpeed: 115, accel: 650, stunMs: 240, knockbackFriction: 7,
      contactDamage: 1, mass: 1, color: 0xff4d6d,
    },

    // Stops, telegraphs a line, then charges along it. Dash through or sidestep.
    charger: {
      radius: 12, hp: 2, maxSpeed: 95, accel: 600, stunMs: 240, knockbackFriction: 7,
      contactDamage: 1, mass: 1, color: 0xff9f1c,
      triggerRange: 280,  // starts winding up when the player is this close
      telegraphMs: 600,
      aimLockMs: 180,     // stops tracking the player this long before launching
      chargeSpeed: 640,
      chargeDistance: 340,
      chargeDamage: 1,
      chargeKnockback: 650,
      recoverMs: 650,     // dazed and harmless after a charge
      cooldownMs: 1200,
    },

    // Keeps its distance, strafes and fires slow bullets. Melee swings delete bullets.
    shooter: {
      radius: 12, hp: 2, maxSpeed: 105, accel: 500, stunMs: 240, knockbackFriction: 7,
      contactDamage: 1, mass: 1, color: 0xb15cff,
      preferredRange: 300,
      rangeSlack: 60,     // happy anywhere within preferredRange +/- this
      strafeSpeed: 70,
      fireRange: 480,
      fireIntervalMs: 1700,
      telegraphMs: 380,
      bulletSpeed: 250,
      bulletRange: 650,
      bulletDamage: 1,
      bulletKnockback: 300,
    },

    // Slow and tanky; light hits don't flinch it, only the combo finisher staggers it.
    // Telegraphs a big sweeping swing. Back off or dash out of the red area.
    brute: {
      radius: 24, hp: 10, maxSpeed: 70, accel: 300, stunMs: 0, knockbackFriction: 6,
      contactDamage: 0, mass: 6, color: 0xc0392b,
      staggerMs: 650,           // stun from a combo finisher (cancels its swing)
      heavyKnockbackScale: 0.4, // finisher knockback multiplier
      attack: {
        triggerRange: 95,       // starts winding up when the player's edge is this close
        reach: 115,
        arcDeg: 200,
        windupMs: 650,
        recoveryMs: 650,
        cooldownMs: 900,
        damage: 2,
        knockback: 650,
        lunge: 40,
        shake: { duration: 120, intensity: 0.007 },
      },
    },
  },

  spawn: {
    startIntervalMs: 1300,
    minIntervalMs: 320,
    rampSeconds: 120,     // time to go from start to min interval
    maxAlive: 70,
    offscreenMargin: 60,
    graceMs: 300,         // enemies can't hurt you right as they pop in
    // Enemy mix over time (seconds). The last stage whose `at` has passed is used.
    // Open the game with ?enemy=brute (or charger/shooter/grunt) to spawn only that type.
    stages: [
      { at: 0, weights: { grunt: 1 } },
      { at: 20, weights: { grunt: 4, charger: 1 } },
      { at: 45, weights: { grunt: 4, charger: 2, shooter: 1 } },
      { at: 75, weights: { grunt: 4, charger: 2, shooter: 2, brute: 1 } },
    ],
    maxAliveByType: { brute: 3, shooter: 6 },
  },

  audio: {
    master: 0.5,          // press M in game to mute
    pitchVariance: 0.06,  // random +/- pitch per sound so repeats don't sound identical
    fullVolumeRange: 350, // world sounds are full volume within this distance of the player
    falloffRange: 800,    // then fade over this distance...
    minWorldVolume: 0.2,  // ...down to this
    panRange: 700,        // horizontal offset that pans fully to one side
  },

  hurtFx: {
    hitstopMs: 90,
    shake: { duration: 180, intensity: 0.012 },
  },
};
