// Procedural sound: every effect is synthesised in WebAudio from oscillators and
// filtered noise, so the game loads nothing from the network. The context is
// created lazily on the first user gesture (browsers forbid audio before one) and
// every call is a no-op until then — the game must never crash headless.
function noiseBuffer(context, seconds) {
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * seconds), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export function createAudio() {
  let context = null;
  let master = null;
  let noise = null;
  let enabled = true;

  function ensure() {
    if (context) {
      if (context.state === 'suspended') context.resume().catch(() => {});
      return context;
    }
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      context = new AudioContextClass();
      master = context.createGain();
      master.gain.value = 0.5;
      master.connect(context.destination);
      noise = noiseBuffer(context, 1);
    } catch {
      context = null;
    }
    return context;
  }

  function burst({ duration = 0.12, frequency = 1200, type = 'lowpass', gain = 0.5, at = 0 }) {
    if (!enabled || !ensure()) return;
    const t = context.currentTime + at;
    const source = context.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(gain, t);
    envelope.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(envelope).connect(master);
    source.start(t);
    source.stop(t + duration + 0.05);
  }

  function tone({ frequency = 440, to = null, duration = 0.1, type = 'sine', gain = 0.25, at = 0 }) {
    if (!enabled || !ensure()) return;
    const t = context.currentTime + at;
    const osc = context.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(gain, t);
    envelope.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(envelope).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  const SHOT_TONE = { p9: 320, vk7: 240, hornet: 300, breacher: 150, longbow: 190 };

  return {
    unlock() {
      ensure();
    },
    setEnabled(value) {
      enabled = value;
    },
    shot(weaponId) {
      burst({ duration: 0.1, frequency: 900, gain: 0.5 });
      tone({ frequency: SHOT_TONE[weaponId] || 240, to: 70, duration: 0.09, type: 'square', gain: 0.22 });
    },
    enemyShot(distance) {
      const gain = Math.max(0.05, 0.35 - distance * 0.008);
      burst({ duration: 0.09, frequency: 700, gain });
    },
    dryFire() {
      tone({ frequency: 1400, duration: 0.03, type: 'square', gain: 0.12 });
    },
    reload() {
      tone({ frequency: 900, duration: 0.04, type: 'square', gain: 0.12 });
      tone({ frequency: 600, duration: 0.04, type: 'square', gain: 0.12, at: 0.18 });
      tone({ frequency: 1100, duration: 0.05, type: 'square', gain: 0.14, at: 0.45 });
    },
    hit() {
      tone({ frequency: 1800, duration: 0.05, type: 'sine', gain: 0.25 });
    },
    kill() {
      tone({ frequency: 1800, duration: 0.05, type: 'sine', gain: 0.25 });
      tone({ frequency: 2400, duration: 0.08, type: 'sine', gain: 0.25, at: 0.06 });
    },
    hurt() {
      tone({ frequency: 180, to: 90, duration: 0.18, type: 'sawtooth', gain: 0.3 });
    },
    explosion() {
      burst({ duration: 0.7, frequency: 320, gain: 0.9 });
      tone({ frequency: 90, to: 35, duration: 0.6, type: 'sine', gain: 0.5 });
    },
    plantBeep() {
      tone({ frequency: 1200, duration: 0.07, type: 'square', gain: 0.15 });
    },
    defuseBeep() {
      tone({ frequency: 900, duration: 0.07, type: 'square', gain: 0.15 });
    },
    planted() {
      tone({ frequency: 660, duration: 0.12, type: 'square', gain: 0.2 });
      tone({ frequency: 880, duration: 0.2, type: 'square', gain: 0.2, at: 0.12 });
    },
    roundWin() {
      [523, 659, 784].forEach((f, i) => tone({ frequency: f, duration: 0.18, type: 'triangle', gain: 0.25, at: i * 0.12 }));
    },
    roundLose() {
      [392, 330, 262].forEach((f, i) => tone({ frequency: f, duration: 0.22, type: 'triangle', gain: 0.22, at: i * 0.14 }));
    },
    buy() {
      tone({ frequency: 1000, duration: 0.05, type: 'sine', gain: 0.2 });
      tone({ frequency: 1400, duration: 0.07, type: 'sine', gain: 0.2, at: 0.05 });
    },
    denied() {
      tone({ frequency: 220, duration: 0.12, type: 'square', gain: 0.18 });
    },
    footstep() {
      burst({ duration: 0.05, frequency: 300, gain: 0.06 });
    },
    grenadePin() {
      tone({ frequency: 2000, duration: 0.03, type: 'square', gain: 0.12 });
    },
    uiClick() {
      tone({ frequency: 800, duration: 0.04, type: 'sine', gain: 0.15 });
    },
  };
}
