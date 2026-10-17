// Online co-op: the one-off effects that copying the screen misses (sounds, particles, screen shake,
// HUD banners). The host records the calls that make them, as [channel, method, args], and sends
// them each frame; the guest makes the same calls on its own objects (see GuestScene).
//
// A call made while another recorded call runs isn't recorded, since replaying the outer call makes it
// again (a boss announcement shows a banner). A sound's handle can stop it early (an enemy's telegraph
// cut short), so sounds carry an id and stopping one is recorded as ['sfxStop', id].

const round = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
// Numbers, and the numbers in a plain object one level down ({ duration, intensity }, { slot, x, y }).
const roundAll = (v) => (v && v.constructor === Object ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : round(v));

export class EventRecorder {
  // encode(arg) turns an argument that can't be sent as it is into one that can.
  constructor(encode = (arg) => arg) {
    this.encode = encode;
    this.queue = [];
    this.depth = 0; // how many recorded calls are running
    this.nextSoundId = 1;
    this.wrapped = []; // [target, name], to undo in dispose()
  }

  // Wraps target's `names` methods so each call is also queued under `channel`. With `sounds`, they
  // return a handle (see sfx.play) whose stop() is recorded too.
  record(channel, target, names, { sounds = false } = {}) {
    for (const name of names) {
      const original = target[name];
      const recorder = this;
      target[name] = function (...args) {
        if (recorder.depth > 0) return original.apply(this, args);
        const event = [channel, name, args.map((arg) => roundAll(recorder.encode(arg)))];
        recorder.queue.push(event);
        recorder.depth++;
        try {
          const result = original.apply(this, args);
          if (!sounds) return result;
          const id = recorder.nextSoundId++;
          event.push(id);
          return {
            stop() {
              result.stop();
              recorder.queue.push(['sfxStop', id]);
            },
          };
        } finally {
          recorder.depth--;
        }
      };
      this.wrapped.push([target, name]);
    }
  }

  // The events since the last take().
  take() {
    const events = this.queue;
    this.queue = [];
    return events;
  }

  // Puts the original methods back (they live on the prototypes).
  dispose() {
    for (const [target, name] of this.wrapped) delete target[name];
    this.wrapped = [];
  }
}

const SOUND_HANDLE_MS = 10000; // stops arrive within a telegraph's length; forget handles after this

// The guest's side: makes each event's call on `targets` ({ channel: object }).
export class EventPlayer {
  constructor(targets) {
    this.targets = targets;
    this.sounds = new Map(); // id -> { handle, at }
  }

  play(events, now) {
    for (const [channel, name, args, id] of events) {
      if (channel === 'sfxStop') {
        this.sounds.get(name)?.handle.stop(); // name holds the id here
        this.sounds.delete(name);
        continue;
      }
      const result = this.targets[channel]?.[name]?.(...args);
      if (id !== undefined) this.sounds.set(id, { handle: result, at: now });
    }
    for (const [id, { at }] of this.sounds) if (now - at > SOUND_HANDLE_MS) this.sounds.delete(id);
  }
}
