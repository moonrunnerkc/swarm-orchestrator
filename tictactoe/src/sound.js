// Tiny Web Audio beep so outcomes are audible in a background tab where the
// visual highlight would otherwise be invisible. First use lazy-builds the
// AudioContext; subsequent calls reuse it.

let ctx = null;

function context() {
  if (ctx) return ctx;
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

export function beep({ frequency = 520, duration = 0.12, volume = 0.12 } = {}) {
  const audio = context();
  if (!audio) return;
  if (audio.state === "suspended") audio.resume().catch(() => {});
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  const start = audio.currentTime;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

export const cues = {
  move: () => beep({ frequency: 520, duration: 0.08, volume: 0.08 }),
  win: () => {
    beep({ frequency: 660, duration: 0.12 });
    setTimeout(() => beep({ frequency: 880, duration: 0.18 }), 110);
  },
  draw: () => beep({ frequency: 300, duration: 0.2, volume: 0.1 }),
};
