// The metronome's kernel: where the clicks fall (the beat grid, the loop,
// the count-in, the accents) and the click sounds themselves. It runs on the
// audio thread, in an AudioWorklet (metronome.ts), and places every click
// at its exact sample - so nothing the page does can delay or drop one.
// Kept as source text like the effects' kernels; the tests run the same
// text.

export const METRONOME_KERNEL_SOURCE = `
const METRONOME_EPS = 1e-6;

// The beats (whole beat positions) that sound from position pos over the
// next span beats of playing time, following the loop like the transport
// does (reaching its end jumps back to its start). inclusive: a beat
// exactly at pos counts. elapsed is how many beats of playing time after
// pos each one sounds.
function clicksAhead(pos, span, loop, inclusive = true) {
  const out = [];
  const looping = loop && loop.end - loop.start > METRONOME_EPS ? loop : null;
  let elapsed = 0;
  let p = pos;
  let include = inclusive;
  // Bounded so a loop with no whole beat inside can't spin forever.
  for (let guard = 0; guard < 10000; guard++) {
    const k = include ? Math.ceil(p - METRONOME_EPS) : Math.floor(p + METRONOME_EPS) + 1;
    if (looping && k >= looping.end - METRONOME_EPS) {
      elapsed += Math.max(0, looping.end - p);
      if (elapsed > span + METRONOME_EPS) break;
      p = looping.start;
      include = true;
      continue;
    }
    elapsed += k - p;
    if (elapsed > span + METRONOME_EPS) break;
    out.push({ elapsed, beat: k });
    p = k;
    include = false;
  }
  return out;
}

// Whether a beat position starts a bar.
function isDownbeat(beat, beatsPerBar) {
  const n = Math.max(1, Math.round(beatsPerBar));
  return ((Math.round(beat) % n) + n) % n === 0;
}

// A short square-ish blip, band-limited so it doesn't alias.
function clickSound(sampleRate, frequency, gainDb) {
  const length = Math.round(0.07 * sampleRate);
  const data = new Float32Array(length);
  const gain = Math.pow(10, gainDb / 20);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    let wave = 0;
    for (let h = 1; h <= 9 && h * frequency < sampleRate / 2; h += 2) wave += Math.sin(2 * Math.PI * h * frequency * t) / h;
    // 1 ms attack, then ~40 ms decay.
    const env = Math.min(1, t / 0.001) * Math.exp(-t / 0.012);
    data[i] = (4 / Math.PI) * wave * env * gain;
  }
  return data;
}

class MetronomeKernel {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.bpm = 120;
    this.beatsPerBar = 4;
    this.loop = null;
    // Clicks after the count-in sound only while this is on.
    this.enabled = false;
    // Where clicking continues from: position pos (beats) at context time
    // time. Null when stopped.
    this.next = null;
    // Context time the transport starts at; clicks before it are the
    // count-in, which always sounds (louder).
    this.startTime = 0;
    // Clicks sounding: their samples, how far in, and when they started.
    this.voices = [];
    this.sounds = {
      accent: clickSound(sampleRate, 1046.5, -14),
      beat: clickSound(sampleRate, 523.25, -14),
      countAccent: clickSound(sampleRate, 1046.5, -8),
      countBeat: clickSound(sampleRate, 523.25, -8),
    };
  }

  // A message from the page (metronome.ts).
  command(m) {
    switch (m.type) {
      case "start":
        // Clicks from beat position pos at context time time, after
        // countInBeats beats of count-in on the same grid.
        this.voices = [];
        this.startTime = m.time;
        this.next = { time: m.time - (m.countInBeats * 60) / this.bpm, pos: m.pos - m.countInBeats, inclusive: true };
        break;
      case "stop":
        this.next = null;
        this.voices = [];
        break;
      case "resync":
        // After a jump, a tempo or a loop change: carry on from position
        // pos at time. Ignored during the count-in (nothing has moved yet).
        if (!this.next || m.time < this.startTime) break;
        this.voices = this.voices.filter((v) => v.time <= m.time);
        this.next = { time: m.time, pos: m.pos, inclusive: true };
        break;
      case "enabled":
        this.enabled = m.enabled;
        break;
      case "tempo":
        this.bpm = m.bpm;
        break;
      case "meter":
        this.beatsPerBar = m.beatsPerBar;
        break;
      case "loop":
        this.loop = m.loop;
        break;
    }
  }

  // Writes this block's clicks into out (out.length frames from context
  // time time), replacing what was there.
  render(out, time) {
    out.fill(0);
    const sr = this.sampleRate;
    const n = out.length;
    const end = time + n / sr;
    const next = this.next;
    if (next && end > next.time) {
      const spb = 60 / this.bpm;
      // The count-in doesn't loop (recording, the only thing with one,
      // plays straight through anyway); from the start, the loop does.
      const loop = next.time >= this.startTime - METRONOME_EPS ? this.loop : null;
      for (const c of clicksAhead(next.pos, (end - next.time) / spb, loop, next.inclusive)) {
        const t = next.time + c.elapsed * spb;
        if (t >= end) break;
        const countIn = t < this.startTime - METRONOME_EPS;
        // A click more than 5 ms late (a start that arrived late) is skipped.
        if (t >= time - 0.005 && (countIn || this.enabled)) {
          const accent = isDownbeat(c.beat, this.beatsPerBar);
          const s = this.sounds;
          const data = countIn ? (accent ? s.countAccent : s.countBeat) : accent ? s.accent : s.beat;
          this.voices.push({ data, index: 0, offset: Math.max(0, Math.round((t - time) * sr)), time: t });
        }
        this.next = { time: t, pos: c.beat, inclusive: false };
      }
    }
    this.voices = this.voices.filter((v) => {
      if (v.offset >= n) {
        v.offset -= n;
        return true;
      }
      for (let i = v.offset; i < n && v.index < v.data.length; i++) out[i] += v.data[v.index++];
      v.offset = 0;
      return v.index < v.data.length;
    });
  }
}
`;
