// A small library of hand-built wavetables for the synth engine (src/lib/synth.ts).
// Each table is a handful of harmonic-content "frames" (an array of harmonic
// amplitudes - index 0 is the fundamental, index 1 the 2nd harmonic, etc.);
// scanning the oscillator's "position" knob from 0 to 1 linearly interpolates
// between adjacent frames' harmonic amplitudes and rebuilds the oscillator's
// PeriodicWave from the result, exactly how a hardware/software wavetable
// oscillator morphs between stored frames - just recomputed on knob movement
// rather than scanned per audio sample.

export type WavetableName = "classic" | "formant" | "organ" | "metallic" | "glitch";

export interface Wavetable {
  name: WavetableName;
  label: string;
  frames: number[][];
}

const HARMONICS = 24;

/** Scales a frame's harmonic amplitudes so every table has roughly the same
 * perceived loudness, regardless of how many harmonics it uses. */
function normalize(partials: number[], target = 0.45): number[] {
  const energy = Math.sqrt(partials.reduce((sum, v) => sum + v * v, 0));
  if (energy < 1e-6) return partials;
  const scale = target / energy;
  return partials.map((v) => v * scale);
}

// The four classic analog shapes, using the same harmonic-series formulas
// Tone.js's own Oscillator uses for "sine"/"triangle"/"sawtooth"/"square" -
// morphing between them reconstructs the same waves at each end of the
// table, with a genuine in-between timbre at intermediate positions.
function sineHarmonics(): number[] {
  return [1, ...new Array(HARMONICS - 1).fill(0)];
}
function triangleHarmonics(): number[] {
  const out: number[] = [];
  for (let n = 1; n <= HARMONICS; n++) {
    if (n % 2 === 1) {
      const piFactor = 2 / (n * Math.PI);
      out.push(2 * piFactor * piFactor * (((n - 1) >> 1) % 2 === 1 ? -1 : 1));
    } else {
      out.push(0);
    }
  }
  return out;
}
function sawtoothHarmonics(): number[] {
  const out: number[] = [];
  for (let n = 1; n <= HARMONICS; n++) {
    const piFactor = 2 / (n * Math.PI);
    out.push(piFactor * (n % 2 === 1 ? 1 : -1));
  }
  return out;
}
function squareHarmonics(): number[] {
  const out: number[] = [];
  for (let n = 1; n <= HARMONICS; n++) {
    const piFactor = 2 / (n * Math.PI);
    out.push(n % 2 === 1 ? 2 * piFactor : 0);
  }
  return out;
}

/** A handful of bell-curve "formant" bumps in the harmonic spectrum, plus a
 * natural 1/n rolloff on top - a stylized, vowel-like resonance shape. */
function formantHarmonics(centers: number[], widths: number[], amps: number[]): number[] {
  const out = new Array(HARMONICS).fill(0);
  for (let n = 1; n <= HARMONICS; n++) {
    let v = 0;
    for (let k = 0; k < centers.length; k++) {
      const d = (n - centers[k]) / widths[k];
      v += amps[k] * Math.exp(-d * d);
    }
    out[n - 1] = v / n;
  }
  return out;
}

/** Only specific harmonics turned on, at set levels - like drawbars on a
 * tonewheel organ. */
function drawbarHarmonics(active: { n: number; amp: number }[]): number[] {
  const out = new Array(HARMONICS).fill(0);
  active.forEach(({ n, amp }) => {
    if (n <= HARMONICS) out[n - 1] = amp;
  });
  return out;
}

/** Emphasizes every `step`th (and `step+1`th) harmonic with a slow decay -
 * an inharmonic-leaning, bell/metallic-flavored comb. */
function metallicHarmonics(step: number, decay: number): number[] {
  const out = new Array(HARMONICS).fill(0);
  for (let n = 1; n <= HARMONICS; n++) {
    out[n - 1] =
      n % step === 0 || n % (step + 1) === 0 ? 1 / Math.pow(n, decay) : 0.15 / Math.pow(n, decay);
  }
  return out;
}

/** A deterministic (seeded) pseudo-random spectrum - increasing `density`
 * across frames gives a progressively noisier, more digital/glitchy texture. */
function seededRandomHarmonics(seed: number, density: number): number[] {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const out = new Array(HARMONICS).fill(0);
  for (let n = 1; n <= HARMONICS; n++) {
    out[n - 1] = rand() < density ? rand() / n : 0;
  }
  return out;
}

export const WAVETABLES: Record<WavetableName, Wavetable> = {
  classic: {
    name: "classic",
    label: "Classic",
    frames: [sineHarmonics(), triangleHarmonics(), sawtoothHarmonics(), squareHarmonics()].map((f) =>
      normalize(f)
    ),
  },
  formant: {
    name: "formant",
    label: "Formant",
    frames: [
      formantHarmonics([2, 6, 14], [1, 2, 3], [1, 0.6, 0.3]),
      formantHarmonics([3, 9, 18], [1, 2, 3], [1, 0.5, 0.25]),
      formantHarmonics([2, 12, 20], [1, 2, 3], [1, 0.7, 0.2]),
      formantHarmonics([4, 7, 16], [1.5, 2, 3], [1, 0.6, 0.3]),
    ].map((f) => normalize(f)),
  },
  organ: {
    name: "organ",
    label: "Organ",
    frames: [
      drawbarHarmonics([{ n: 1, amp: 1 }]),
      drawbarHarmonics([
        { n: 1, amp: 1 },
        { n: 2, amp: 0.7 },
        { n: 3, amp: 0.5 },
      ]),
      drawbarHarmonics([
        { n: 1, amp: 0.8 },
        { n: 2, amp: 0.8 },
        { n: 3, amp: 0.6 },
        { n: 4, amp: 0.5 },
        { n: 6, amp: 0.4 },
      ]),
      drawbarHarmonics([
        { n: 1, amp: 0.6 },
        { n: 2, amp: 0.7 },
        { n: 3, amp: 0.8 },
        { n: 4, amp: 0.6 },
        { n: 6, amp: 0.6 },
        { n: 8, amp: 0.5 },
      ]),
    ].map((f) => normalize(f)),
  },
  metallic: {
    name: "metallic",
    label: "Metallic",
    frames: [
      metallicHarmonics(3, 1.2),
      metallicHarmonics(5, 0.9),
      metallicHarmonics(7, 0.7),
      metallicHarmonics(2, 0.6),
    ].map((f) => normalize(f)),
  },
  glitch: {
    name: "glitch",
    label: "Glitch",
    frames: [
      seededRandomHarmonics(1, 0.3),
      seededRandomHarmonics(2, 0.5),
      seededRandomHarmonics(3, 0.7),
      seededRandomHarmonics(4, 0.9),
    ].map((f) => normalize(f)),
  },
};

export const WAVETABLE_NAMES: WavetableName[] = ["classic", "formant", "organ", "metallic", "glitch"];

/** The harmonic-amplitude array at a given scan position (0..1) through a
 * wavetable - linearly interpolates the two nearest frames, matching how a
 * wavetable oscillator morphs as its position knob moves. */
export function wavetablePartialsAt(table: Wavetable, position: number): number[] {
  const frames = table.frames;
  if (frames.length === 1) return frames[0];
  const clamped = Math.max(0, Math.min(1, position));
  const scaled = clamped * (frames.length - 1);
  const i0 = Math.floor(scaled);
  const i1 = Math.min(frames.length - 1, i0 + 1);
  const t = scaled - i0;
  const a = frames[i0];
  const b = frames[i1];
  const len = Math.max(a.length, b.length);
  const out = new Array(len);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    out[i] = av + (bv - av) * t;
  }
  return out;
}
