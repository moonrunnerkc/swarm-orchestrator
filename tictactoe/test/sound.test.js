import test from "node:test";
import assert from "node:assert/strict";

// We import the module fresh per test so the lazy AudioContext singleton
// inside sound.js doesn't leak state across cases.
async function loadSound() {
  const url = new URL(`../src/sound.js?case=${Math.random()}`, import.meta.url);
  return import(url);
}

function makeFakeAudio({ state = "running" } = {}) {
  const events = [];
  const oscillator = {
    type: null,
    frequency: { value: 0 },
    connect(node) {
      events.push(["osc.connect", node === gain ? "gain" : "other"]);
      return node;
    },
    start(t) {
      events.push(["osc.start", t]);
    },
    stop(t) {
      events.push(["osc.stop", t]);
    },
  };
  const gain = {
    gain: {
      setValueAtTime(v, t) {
        events.push(["gain.set", v, t]);
      },
      linearRampToValueAtTime(v, t) {
        events.push(["gain.linear", v, t]);
      },
      exponentialRampToValueAtTime(v, t) {
        events.push(["gain.exp", v, t]);
      },
    },
    connect(node) {
      events.push(["gain.connect", node === audio.destination ? "destination" : "other"]);
      return node;
    },
  };
  const audio = {
    state,
    currentTime: 1.0,
    destination: { __destination: true },
    createOscillator: () => oscillator,
    createGain: () => gain,
    resume() {
      events.push(["resume"]);
      return Promise.resolve();
    },
    events,
  };
  return audio;
}

async function withAudioContext(fakeAudio, fn) {
  const prevAC = globalThis.AudioContext;
  const prevWAC = globalThis.webkitAudioContext;
  let constructed = 0;
  globalThis.AudioContext = function () {
    constructed += 1;
    return fakeAudio;
  };
  delete globalThis.webkitAudioContext;
  try {
    return await fn(() => constructed);
  } finally {
    globalThis.AudioContext = prevAC;
    globalThis.webkitAudioContext = prevWAC;
  }
}

test("beep is a no-op when no AudioContext is available", async () => {
  const prevAC = globalThis.AudioContext;
  const prevWAC = globalThis.webkitAudioContext;
  delete globalThis.AudioContext;
  delete globalThis.webkitAudioContext;
  try {
    const { beep } = await loadSound();
    // Must not throw even though there's no audio backend.
    assert.equal(beep(), undefined);
  } finally {
    globalThis.AudioContext = prevAC;
    globalThis.webkitAudioContext = prevWAC;
  }
});

test("beep wires an oscillator+gain node and schedules start/stop", async () => {
  const fake = makeFakeAudio();
  await withAudioContext(fake, async (count) => {
    const { beep } = await loadSound();
    beep({ frequency: 440, duration: 0.1, volume: 0.2 });

    const ev = fake.events;
    // Frequency was applied to the oscillator.
    assert.ok(
      ev.some(([k, v]) => k === "gain.linear" && v === 0.2),
      "gain ramps to the requested volume",
    );
    assert.ok(
      ev.some(([k]) => k === "osc.start"),
      "oscillator starts",
    );
    const stop = ev.find(([k]) => k === "osc.stop");
    assert.ok(stop, "oscillator stops");
    // start at currentTime (1.0), stop at start + duration + 0.02 = 1.12
    assert.ok(Math.abs(stop[1] - 1.12) < 1e-9, "stop time is start+duration+0.02");
    // Audio graph is wired osc -> gain -> destination.
    assert.deepEqual(
      ev.filter(([k]) => k.endsWith(".connect")),
      [["osc.connect", "gain"], ["gain.connect", "destination"]],
    );
    assert.equal(count(), 1, "AudioContext is constructed exactly once");
  });
});

test("AudioContext is reused across multiple beep calls", async () => {
  const fake = makeFakeAudio();
  await withAudioContext(fake, async (count) => {
    const { beep } = await loadSound();
    beep();
    beep();
    beep();
    assert.equal(count(), 1, "context is lazily created and reused");
  });
});

test("beep resumes a suspended AudioContext", async () => {
  const fake = makeFakeAudio({ state: "suspended" });
  await withAudioContext(fake, async () => {
    const { beep } = await loadSound();
    beep();
    assert.ok(fake.events.some(([k]) => k === "resume"), "resume() is called");
  });
});

test("beep falls back to webkitAudioContext when AudioContext is missing", async () => {
  const fake = makeFakeAudio();
  const prevAC = globalThis.AudioContext;
  const prevWAC = globalThis.webkitAudioContext;
  delete globalThis.AudioContext;
  let constructed = 0;
  globalThis.webkitAudioContext = function () {
    constructed += 1;
    return fake;
  };
  try {
    const { beep } = await loadSound();
    beep();
    assert.equal(constructed, 1, "webkit fallback is used");
  } finally {
    globalThis.AudioContext = prevAC;
    globalThis.webkitAudioContext = prevWAC;
  }
});

test("cues.move triggers a single short beep at the move frequency", async () => {
  const fake = makeFakeAudio();
  await withAudioContext(fake, async () => {
    const { cues } = await loadSound();
    cues.move();
    assert.equal(fake.events.filter(([k]) => k === "osc.start").length, 1);
  });
});

test("cues.win schedules a second beep via setTimeout", async (t) => {
  const fake = makeFakeAudio();
  await withAudioContext(fake, async () => {
    const { cues } = await loadSound();
    const realSetTimeout = globalThis.setTimeout;
    let scheduledMs = null;
    let scheduledFn = null;
    globalThis.setTimeout = (fn, ms) => {
      scheduledFn = fn;
      scheduledMs = ms;
      return 0;
    };
    try {
      cues.win();
      assert.equal(scheduledMs, 110, "second beep is scheduled ~110ms later");
      assert.equal(typeof scheduledFn, "function");
      const startsBefore = fake.events.filter(([k]) => k === "osc.start").length;
      scheduledFn();
      const startsAfter = fake.events.filter(([k]) => k === "osc.start").length;
      assert.equal(startsAfter, startsBefore + 1, "deferred beep actually plays");
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });
});

test("cues.draw plays a single low-frequency beep", async () => {
  const fake = makeFakeAudio();
  await withAudioContext(fake, async () => {
    const { cues } = await loadSound();
    cues.draw();
    assert.equal(fake.events.filter(([k]) => k === "osc.start").length, 1);
  });
});
