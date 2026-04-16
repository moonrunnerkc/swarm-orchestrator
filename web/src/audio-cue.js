// Short Web Audio beep for non-visual feedback (e.g. autosave confirmation
// when the tab is backgrounded). Lazily constructs the AudioContext on the
// first user-triggered call, since browsers block audio before a gesture.

let ctx = null;

const ensureContext = () => {
  if (ctx) return ctx;
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
};

export const beep = ({ frequency = 660, duration = 0.08, volume = 0.05 } = {}) => {
  const audio = ensureContext();
  if (!audio) return;
  if (audio.state === "suspended") audio.resume().catch(() => {});

  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;

  const now = audio.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain).connect(audio.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
};
