// Wavetables for the synth: each is a stack of single-cycle "frames" that
// the Position knob scans through. A table is built once (on the main
// thread) into band-limited copies ("mip levels"), each with fewer
// harmonics than the last, and handed to the worklet: a note plays from
// the richest level whose harmonics stay (or alias) above hearing, so high
// notes don't alias and low notes keep their top end.
//
// Factory tables are made here, either from a spectrum (harmonic levels) or
// from a drawn single cycle; an imported audio file is cut into 2048-sample
// cycles, the way Ableton's Wavetable does it.

export const WAVETABLE_IDS = [
  "basic",
  "daybreak",
  "harmonics",
  "pulse",
  "analog",
  "vowels",
  "choir",
  "organ",
  "bells",
  "fm",
  "fmBright",
  "sync",
  "fold",
  "resonant",
  "growl",
  "digital",
  "glitch",
] as const;
export type WavetableId = (typeof WAVETABLE_IDS)[number];

export const WAVETABLE_INFO: Record<WavetableId, { name: string; group: string }> = {
  basic: { name: "Basic Shapes", group: "Classic" },
  daybreak: { name: "Daybreak", group: "Classic" },
  harmonics: { name: "Harmonic Series", group: "Classic" },
  pulse: { name: "Pulse Width", group: "Classic" },
  analog: { name: "Analog Drift", group: "Classic" },
  vowels: { name: "Vowels", group: "Vocal" },
  choir: { name: "Choir", group: "Vocal" },
  organ: { name: "Drawbars", group: "Keys" },
  bells: { name: "Bells", group: "Keys" },
  fm: { name: "FM Sweep", group: "Digital" },
  fmBright: { name: "FM Octaves", group: "Digital" },
  sync: { name: "Hard Sync", group: "Digital" },
  fold: { name: "Wavefolder", group: "Digital" },
  resonant: { name: "Resonant Sweep", group: "Filtered" },
  growl: { name: "Growl", group: "Filtered" },
  digital: { name: "Bitcrush", group: "Digital" },
  glitch: { name: "Glitch", group: "Digital" },
};

/** Harmonics kept at each mip level (level 0 is the richest). */
export const MIP_HARMONICS = [512, 256, 128, 64, 32, 16, 8, 4, 2];
/** Samples per cycle at each level: four per highest harmonic at least, so
 * linear interpolation stays clean. */
export const MIP_SIZES = MIP_HARMONICS.map((h) => Math.max(128, h * 4));
export const MAX_FRAMES = 64;
/** Samples per cycle in an imported file. */
export const IMPORT_CYCLE = 2048;

export interface WavetableData {
  frames: number;
  /** One array per mip level: `frames` cycles of MIP_SIZES[level] samples. */
  levels: Float32Array[];
}

// --- FFT ---

/** In-place radix-2 complex FFT (inverse without the 1/n scale). */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** A frame's harmonics 1..512 as sine and cosine coefficients. */
export interface Spectrum {
  sin: Float64Array;
  cos: Float64Array;
}

const H = MIP_HARMONICS[0];

function emptySpectrum(): Spectrum {
  return { sin: new Float64Array(H + 1), cos: new Float64Array(H + 1) };
}

/** The harmonics of one cycle (any power-of-two length). */
export function cycleToSpectrum(cycle: ArrayLike<number>): Spectrum {
  const n = cycle.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = cycle[i];
  fft(re, im);
  const s = emptySpectrum();
  const top = Math.min(H, n / 2 - 1);
  for (let k = 1; k <= top; k++) {
    // x(t) = sum(cos_k cos(2πkt) + sin_k sin(2πkt))
    s.cos[k] = (2 * re[k]) / n;
    s.sin[k] = (-2 * im[k]) / n;
  }
  return s;
}

/** One cycle of `size` samples holding the spectrum's harmonics up to `maxHarmonic`. */
export function spectrumToCycle(s: Spectrum, size: number, maxHarmonic: number): Float64Array {
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const top = Math.min(maxHarmonic, size / 2 - 1, H);
  for (let k = 1; k <= top; k++) {
    re[k] = (s.cos[k] * size) / 2;
    im[k] = (-s.sin[k] * size) / 2;
    re[size - k] = re[k];
    im[size - k] = -im[k];
  }
  fft(re, im, true);
  for (let i = 0; i < size; i++) re[i] /= size;
  return re;
}

/** Builds the mip levels for a list of frames, each normalized to a peak
 * of 1 (so scanning the table doesn't jump in level). */
export function buildWavetable(spectra: Spectrum[]): WavetableData {
  const frames = spectra.length;
  const levels = MIP_SIZES.map((size) => new Float32Array(frames * size));
  spectra.forEach((s, f) => {
    const full = spectrumToCycle(s, MIP_SIZES[0], MIP_HARMONICS[0]);
    let peak = 0;
    for (let i = 0; i < full.length; i++) peak = Math.max(peak, Math.abs(full[i]));
    const scale = peak > 1e-9 ? 1 / peak : 0;
    MIP_SIZES.forEach((size, level) => {
      const cycle = level === 0 ? full : spectrumToCycle(s, size, MIP_HARMONICS[level]);
      const out = levels[level];
      for (let i = 0; i < size; i++) out[f * size + i] = cycle[i] * scale;
    });
  });
  return { frames, levels };
}

// --- factory tables ---

type SpectrumFn = (t: number) => Spectrum;
type CycleFn = (t: number, x: number) => number;

/** A spectrum from harmonic levels (sine phase). */
function fromAmps(amp: (k: number) => number, phase: (k: number) => number = () => 0): Spectrum {
  const s = emptySpectrum();
  for (let k = 1; k <= H; k++) {
    const a = amp(k);
    if (a === 0) continue;
    const ph = phase(k);
    s.sin[k] = a * Math.cos(ph);
    s.cos[k] = a * Math.sin(ph);
  }
  return s;
}

function mix(a: Spectrum, b: Spectrum, t: number): Spectrum {
  const s = emptySpectrum();
  for (let k = 1; k <= H; k++) {
    s.sin[k] = a.sin[k] + (b.sin[k] - a.sin[k]) * t;
    s.cos[k] = a.cos[k] + (b.cos[k] - a.cos[k]) * t;
  }
  return s;
}

/** Frames morphing through keyframes in order. */
function morph(keys: Spectrum[], frames: number): Spectrum[] {
  return Array.from({ length: frames }, (_, f) => {
    const x = (f / (frames - 1)) * (keys.length - 1);
    const i = Math.min(keys.length - 2, Math.floor(x));
    return mix(keys[i], keys[i + 1], x - i);
  });
}

const sine = () => fromAmps((k) => (k === 1 ? 1 : 0));
const triangle = () => fromAmps((k) => (k % 2 === 1 ? (8 / (Math.PI * Math.PI * k * k)) * (((k - 1) / 2) % 2 === 0 ? 1 : -1) : 0));
const saw = () => fromAmps((k) => ((2 / (Math.PI * k)) * (k % 2 === 1 ? 1 : -1)));
const square = () => fromAmps((k) => (k % 2 === 1 ? 4 / (Math.PI * k) : 0));
/** A pulse, high for `d` of the cycle. */
function pulse(d: number): Spectrum {
  return fromCycle((_, x) => (x < d ? 1 : -1), 0, 8192);
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Formant peaks (Hz) of sung vowels, for a spectrum at ~110 Hz. */
const VOWELS: [number, number, number][] = [
  [730, 1090, 2440], // a
  [530, 1840, 2480], // e
  [270, 2290, 3010], // i
  [570, 840, 2410], // o
  [300, 870, 2240], // u
];

function vowelSpectrum(f: [number, number, number], base = 110, bright = 1): Spectrum {
  return fromAmps((k) => {
    const hz = k * base;
    const peaks = f.reduce((sum, c, i) => sum + [1, 0.6, 0.35][i] * Math.exp(-(((hz - c) / (70 + c * 0.08)) ** 2)), 0);
    return (peaks + 0.02) / Math.pow(k, 0.7 / bright);
  });
}

function fromCycle(fn: CycleFn, t: number, size = 4096): Spectrum {
  const cycle = new Float64Array(size);
  for (let i = 0; i < size; i++) cycle[i] = fn(t, i / size);
  return cycleToSpectrum(cycle);
}

function frames(n: number, fn: SpectrumFn): Spectrum[] {
  return Array.from({ length: n }, (_, f) => fn(n === 1 ? 0 : f / (n - 1)));
}

const FACTORY: Record<WavetableId, () => Spectrum[]> = {
  basic: () => morph([sine(), triangle(), saw(), square(), pulse(0.18)], 33),
  // Our own: a warm, rounded saw that opens up, then a resonant glint rises.
  daybreak: () =>
    frames(48, (t) =>
      fromAmps(
        (k) => {
          const cutoff = 2 + 60 * t * t;
          const tone = 1 / (1 + Math.pow(k / cutoff, 2.2));
          const glint = 0.9 * t * Math.exp(-(((k - (3 + 40 * t)) / (1.5 + 3 * t)) ** 2));
          return (tone + glint) / k;
        },
        (k) => (k % 2 === 0 ? Math.PI : 0)
      )
    ),
  harmonics: () =>
    frames(48, (t) => {
      const top = Math.pow(2, t * 9);
      return fromAmps((k) => (k <= top ? 1 / k : k <= top * 1.5 ? (1 - (k - top) / (top * 0.5)) / k : 0));
    }),
  pulse: () => frames(40, (t) => pulse(0.5 - 0.47 * t)),
  // A saw whose even harmonics shift phase: the slow "drift" of a stack of analog saws.
  analog: () =>
    frames(40, (t) => {
      const rnd = seeded(7);
      const offsets = Array.from({ length: H + 1 }, () => rnd() * 2 - 1);
      return fromAmps(
        (k) => (1 / k) * (1 - 0.3 * t * Math.sin(k * 0.7)),
        (k) => offsets[k] * t * Math.PI * Math.min(1, k / 12)
      );
    }),
  vowels: () => morph([...VOWELS, VOWELS[0]].map((v) => vowelSpectrum(v)), 49),
  choir: () =>
    frames(40, (t) => {
      const a = VOWELS[3];
      const b = VOWELS[1];
      const f: [number, number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      const rnd = seeded(31);
      const phases = Array.from({ length: H + 1 }, () => rnd() * Math.PI * 2);
      const v = vowelSpectrum(f, 220, 0.6);
      return fromAmps(
        (k) => Math.hypot(v.sin[k], v.cos[k]) * (k > 24 ? Math.exp(-(k - 24) / 10) : 1),
        (k) => phases[k]
      );
    }),
  organ: () => {
    const bars = (levels: [number, number, number, number, number, number, number, number, number]) => {
      // 16', 5 1/3', 8', 4', 2 2/3', 2', 1 3/5', 1 1/3', 1' - relative to 8'.
      const harmonic = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8];
      return fromAmps((k) => {
        let a = 0;
        harmonic.forEach((h, i) => {
          if (h === k) a += levels[i] / 8;
          if (h * 2 === k) a += levels[i] / 64; // a little key click / foldover
        });
        return a;
      });
    };
    return morph(
      [
        bars([0, 0, 8, 0, 0, 0, 0, 0, 0]),
        bars([8, 8, 8, 0, 0, 0, 0, 0, 0]),
        bars([8, 8, 8, 8, 0, 0, 0, 0, 0]),
        bars([8, 6, 8, 8, 6, 8, 0, 0, 0]),
        bars([8, 8, 8, 8, 8, 8, 8, 8, 8]),
      ],
      33
    );
  },
  bells: () =>
    frames(40, (t) => {
      const partials = [1, 2.0, 3.0, 4.2, 5.4, 6.8, 8.9, 11.2, 13.5];
      return fromAmps((k) => {
        let a = 0;
        partials.forEach((p, i) => {
          const at = Math.round(p * (1 + t * 0.9));
          if (at === k) a += Math.pow(0.72, i) * (i === 0 ? 1 : 0.6 + t);
        });
        return a;
      });
    }),
  fm: () => frames(48, (t) => fromCycle((tt, x) => Math.sin(2 * Math.PI * x + tt * 7 * Math.sin(2 * Math.PI * x)), t)),
  fmBright: () => frames(48, (t) => fromCycle((tt, x) => Math.sin(2 * Math.PI * x + tt * 5 * Math.sin(2 * Math.PI * 2 * x)), t)),
  sync: () =>
    frames(48, (t) =>
      fromCycle((tt, x) => {
        const ratio = 1 + tt * 7;
        const ph = (x * ratio) % 1;
        return (1 - 2 * ph) * (1 - x * 0.35);
      }, t, 8192)
    ),
  fold: () =>
    frames(48, (t) =>
      fromCycle((tt, x) => {
        const v = Math.sin(2 * Math.PI * x) * (1 + tt * 6);
        return Math.sin(v * Math.PI * 0.5);
      }, t)
    ),
  resonant: () =>
    frames(48, (t) => {
      const center = 2 + Math.pow(2, t * 7);
      return fromAmps((k) => (1 / k) * (1 / (1 + Math.pow(k / center, 4)) + 2.5 * Math.exp(-(((k - center) / (0.8 + center * 0.08)) ** 2))));
    }),
  growl: () =>
    frames(48, (t) => {
      const center = 3 + 20 * (0.5 - 0.5 * Math.cos(t * Math.PI * 2));
      const odd = 0.5 + 0.5 * Math.sin(t * Math.PI);
      return fromAmps((k) => {
        const f = 1 + 3 * Math.exp(-(((k - center) / 2.5) ** 2));
        return ((k % 2 === 1 ? 1 : 1 - odd) * f) / k;
      });
    }),
  digital: () =>
    frames(40, (t) =>
      fromCycle((tt, x) => {
        const steps = Math.round(64 / Math.pow(2, tt * 5));
        const held = Math.floor(x * steps * 2) / (steps * 2);
        const v = Math.sin(2 * Math.PI * held) * 0.6 + (1 - 2 * held) * 0.4;
        const bits = Math.max(1, Math.round(8 - tt * 6));
        const q = Math.pow(2, bits);
        return Math.round(v * q) / q;
      }, t, 8192)
    ),
  glitch: () => {
    const keys = Array.from({ length: 8 }, (_, i) => {
      const rnd = seeded(101 + i * 17);
      const density = 0.15 + i * 0.1;
      return fromAmps(
        (k) => (k === 1 ? 0.6 : rnd() < density ? (rnd() * 1.5) / Math.pow(k, 0.8) : 0),
        () => rnd() * Math.PI * 2
      );
    });
    return morph(keys, 43);
  },
};

const factoryCache = new Map<WavetableId, WavetableData>();

/** A factory table, built on first use. */
export function factoryWavetable(id: WavetableId): WavetableData {
  let data = factoryCache.get(id);
  if (!data) {
    const spectra = (FACTORY[id] ?? FACTORY.basic)();
    data = buildWavetable(spectra.slice(0, MAX_FRAMES));
    factoryCache.set(id, data);
  }
  return data;
}

let subTable: WavetableData | null = null;

/** The sub oscillator's shapes, one per frame: sine, triangle, saw, square. */
export function subWavetable(): WavetableData {
  if (!subTable) subTable = buildWavetable([sine(), triangle(), saw(), square()]);
  return subTable;
}

/** A wavetable from audio: consecutive 2048-sample cycles (up to 64, spread
 * across the file), or the whole file as one cycle when it's shorter. */
export function wavetableFromAudio(samples: Float32Array): WavetableData {
  if (samples.length === 0) return buildWavetable([sine()]);
  const count = Math.floor(samples.length / IMPORT_CYCLE);
  const spectra: Spectrum[] = [];
  if (count < 1) {
    // Stretch the whole file into one cycle.
    const cycle = new Float64Array(IMPORT_CYCLE);
    for (let i = 0; i < IMPORT_CYCLE; i++) {
      const x = (i / IMPORT_CYCLE) * samples.length;
      const i0 = Math.floor(x);
      const i1 = Math.min(samples.length - 1, i0 + 1);
      cycle[i] = samples[i0] + (samples[i1] - samples[i0]) * (x - i0);
    }
    spectra.push(cycleToSpectrum(cycle));
  } else {
    const used = Math.min(MAX_FRAMES, count);
    for (let f = 0; f < used; f++) {
      const start = Math.round((f / Math.max(1, used - 1)) * (count - 1)) * IMPORT_CYCLE;
      spectra.push(cycleToSpectrum(samples.subarray(start, start + IMPORT_CYCLE)));
    }
  }
  return buildWavetable(spectra);
}

/** Frames for drawing (from the level with 128 harmonics, `points` samples each). */
export function previewFrames(data: WavetableData, points = 128): Float32Array[] {
  const level = 2;
  const size = MIP_SIZES[level];
  const table = data.levels[level];
  return Array.from({ length: data.frames }, (_, f) => {
    const out = new Float32Array(points);
    for (let i = 0; i < points; i++) out[i] = table[f * size + Math.floor((i / points) * size)];
    return out;
  });
}

/** Picks the richest mip level whose top harmonic, at `freq` Hz (times any
 * warp that speeds the cycle up), is below Nyquist or aliases back above 20 kHz. */
export function mipLevelFor(freq: number, sampleRate: number): number {
  const ceiling = Math.max(0.5, 1 - 20000 / sampleRate) * sampleRate;
  const maxHarmonic = ceiling / Math.max(1e-6, freq);
  for (let l = 0; l < MIP_HARMONICS.length; l++) if (MIP_HARMONICS[l] <= maxHarmonic) return l;
  return MIP_HARMONICS.length - 1;
}
