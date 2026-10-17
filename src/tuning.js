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

  // Each playable class's own numbers, by class id (see src/classes/). Movement and health above are
  // shared by all of them.
  classes: {
    // Sword combo, a dash, and heavy bolts charged by sword hits.
    knight: {
      dash: {
        distance: 150,
        durationMs: 130,
        cooldownMs: 550,      // counted from the end of the dash
        bufferMs: 120,
        invulnGraceMs: 60,    // stay untouchable this long after the dash ends
        exitSpeed: 260,       // speed you come out of the dash with (player maxSpeed = seamless run)
        ghostIntervalMs: 18,  // afterimage spacing
      },

      // A heavy bolt that costs a charge. Charges are earned with the sword, one pip at a time, and
      // don't decay. Bolts pierce, hitting each enemy once.
      ranged: {
        pipsPerCharge: 3,     // a shot costs this many pips
        maxCharges: 2,        // shots that can be stored
        startCharges: 1,
        hitPips: 1,           // per enemy hit by a swing, finisher included
        cooldownMs: 300,
        bufferMs: 120,
        speed: 580,
        range: 700,           // bolt fizzles after travelling this far
        damage: 3,
        pierceBonus: 1,       // extra damage for each enemy the bolt already went through
        knockback: 520,
        stunMs: 400,          // also staggers a brute, like a finisher
        recoil: 220,          // pushes the player backward per shot
        hitstopMs: 50,
        killHitstopMs: 70,
        shake: { duration: 90, intensity: 0.006 },
        hitShake: { duration: 80, intensity: 0.005 },
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
    },

    // No plain dash: the attack is the dash. Hits fill a momentum bar that drains if you stop hitting;
    // a full bar buys a whirlwind.
    berserker: {
      // Dash toward the aim, cutting through everything in the way. A strike that hits something can
      // be chained straight into the next one; a miss leaves you on cooldown.
      strike: {
        distance: 165,
        durationMs: 140,
        exitSpeed: 200,
        invulnGraceMs: 60,    // untouchable for the strike and this long after
        hitPad: 10,           // reach beyond the two bodies touching
        bufferMs: 160,
        chainCooldownMs: 40,  // after a strike that hit something, counted from its end
        missCooldownMs: 650,  // after a strike that hit nothing
        stoppedCooldownMs: 450, // after a strike that a heavy enemy stopped: no chaining off a brute
        assistRange: 60,      // bend toward the nearest enemy within distance + this...
        assistDeg: 30,        // ...and this close to the aim
        damage: 2,
        rageDamage: 3,        // while the bar is at or above meter.rageAt
        knockback: 380,
        stopMass: 4,          // enemies this heavy (the brute) stop the strike, unless raging...
        bounce: 280,          // ...knocking you back at this speed
        hitstopMs: 45,        // first enemy of a strike; later ones get a shorter freeze
        chainHitstopMs: 20,
        killHitstopBonusMs: 20,
        ghostIntervalMs: 14,
        shake: { duration: 70, intensity: 0.004 },
        // Drawn during a strike and fading out after it: a spearhead ahead of you (see pixelSpearhead)...
        head: { back: 14, length: 56, halfWidth: 26, sweep: 10, hollow: 34, wall: 8, rim: 4, fadeMs: 140 },
        // ...and speed lines streaming back out of it, each the colour of the part it grows from:
        // `tip` lines out of the solid tip (across the hero, `tipSpread` px apart), one out of each
        // side wall, and one out of each shoulder point's rim. The outer lines run longest, the
        // middle ones `innerLength` of that; every flickerMs each one's length is rerolled by up to
        // `jitter` of it. tipAlpha: how see-through the tip lines are where they cross the hero.
        speedLines: {
          tip: 3, tipSpread: 8, length: 95, innerLength: 0.6, halfWidth: 3, tipAlpha: 0.7,
          jitter: 0.35, flickerMs: 45,
        },
      },

      // Momentum, 0 to max. Drains after a moment without a hit. Hitstop and strikes pause the drain.
      meter: {
        max: 100,
        perHit: 12,
        perKill: 6,           // on top of perHit
        graceMs: 700,         // drain starts this long after the last gain
        drainPerSec: 35,
        rageAt: 50,           // at or above: harder strikes that go through brutes
      },

      // A full bar: spin and hit everything around you. Spends the whole bar, kills refund some.
      spin: {
        bufferMs: 160,
        radius: 115,          // from your center to the enemy's edge
        damage: 4,
        knockback: 720,
        stunMs: 450,          // also staggers a brute
        refundPerKill: 12,
        swingMs: 260,         // how long the axe takes to go round
        invulnMs: 300,
        hitstopMs: 110,
        shake: { duration: 200, intensity: 0.012 },
      },
    },
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
    // Up close it telegraphs a big sweeping swing; from mid range it leaps at you and slams the
    // ground. Both hit other enemies too, and both leave it open for a moment afterwards.
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
      jump: {
        minRange: 150,          // leaps when the player's edge is between these distances
        maxRange: 340,
        maxLeap: 300,           // never lands further than this from where it took off
        crouchMs: 550,          // landing spot follows the player, then locks on takeoff
        airMs: 520,
        height: 90,             // peak of the arc, visual only
        radius: 85,             // slam area around the landing spot
        recoverMs: 950,         // stuck after landing: the opening to punish it
        cooldownMs: 2600,       // counted from the end of recovery
        damage: 2,
        knockback: 700,
        shake: { duration: 180, intensity: 0.012 },
      },
      // Its swing and slam also hit other enemies. Enough to kill a grunt, charger or shooter outright.
      friendlyFire: { damage: 3, knockback: 520, stunMs: 400 },
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
