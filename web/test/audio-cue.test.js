import test from "node:test";
import assert from "node:assert/strict";

// audio-cue lazily binds globalThis.AudioContext on first call, so install a
// fake constructor before importing — the module captures whichever shim is
// present when beep() is invoked.
class FakeOscillator {
  constructor() {
    this.type = "square";
    this.frequency = { value: 0 };
    this.started = null;
    this.stopped = null;
    this.connections = [];
  }
  connect(node) {
    this.connections.push(node);
    return node;
  }
  start(t) {
    this.started = t;
  }
  stop(t) {
    this.stopped = t;
  }
}

class FakeGainNode {
  constructor() {
    this.connections = [];
    this.gain = {
      events: [],
      setValueAtTime(v, t) {
        this.events.push({ kind: "set", v, t });
      },
      linearRampToValueAtTime(v, t) {
        this.events.push({ kind: "linear", v, t });
      },
      exponentialRampToValueAtTime(v, t) {
        this.events.push({ kind: "exp", v, t });
      },
    };
  }
  connect(node) {
    this.connections.push(node);
    return node;
  }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 100;
    this.destination = { name: "destination" };
    this.state = "running";
    this.resumed = 0;
    this.oscillators = [];
    this.gains = [];
    FakeAudioContext.instances.push(this);
  }
  createOscillator() {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }
  createGain() {
    const gain = new FakeGainNode();
    this.gains.push(gain);
    return gain;
  }
  resume() {
    this.resumed += 1;
    this.state = "running";
    return Promise.resolve();
  }
}
FakeAudioContext.instances = [];

globalThis.AudioContext = FakeAudioContext;
// Fresh import after globals are patched so the module picks up our fake.
const { beep } = await import("../src/audio-cue.js");

test("beep schedules an oscillator with the configured frequency and duration", () => {
  FakeAudioContext.instances.length = 0;
  beep({ frequency: 440, duration: 0.1, volume: 0.2 });
  assert.equal(FakeAudioContext.instances.length, 1);
  const audio = FakeAudioContext.instances[0];
  assert.equal(audio.oscillators.length, 1);
  const osc = audio.oscillators[0];
  assert.equal(osc.type, "sine");
  assert.equal(osc.frequency.value, 440);
  assert.equal(osc.started, 100);
  assert.ok(osc.stopped > 100 + 0.1, "stop time must be after start + duration");
});

test("beep applies a gain envelope (set, linear ramp up, exponential decay)", () => {
  beep({ frequency: 660, duration: 0.05, volume: 0.1 });
  const audio = FakeAudioContext.instances.at(-1);
  const gain = audio.gains.at(-1);
  const kinds = gain.gain.events.map((e) => e.kind);
  assert.deepEqual(kinds, ["set", "linear", "exp"]);
  assert.equal(gain.gain.events[1].v, 0.1);
});

test("beep reuses the AudioContext across calls", () => {
  const before = FakeAudioContext.instances.length;
  beep();
  beep();
  assert.equal(FakeAudioContext.instances.length, before, "no new contexts should be constructed");
});

test("beep resumes a suspended AudioContext", () => {
  const audio = FakeAudioContext.instances.at(-1);
  audio.state = "suspended";
  const resumedBefore = audio.resumed;
  beep();
  assert.equal(audio.resumed, resumedBefore + 1);
});

test("beep is a no-op when no AudioContext constructor is available", async () => {
  const original = globalThis.AudioContext;
  const originalWebkit = globalThis.webkitAudioContext;
  delete globalThis.AudioContext;
  delete globalThis.webkitAudioContext;
  // Re-import with cache-busting query so the module rebinds to the now-missing constructor.
  const fresh = await import("../src/audio-cue.js?no-audio");
  assert.doesNotThrow(() => fresh.beep({ frequency: 880 }));
  globalThis.AudioContext = original;
  if (originalWebkit) globalThis.webkitAudioContext = originalWebkit;
});
