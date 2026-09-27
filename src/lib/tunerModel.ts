// The Tuner's pitch detection and note math. Detection is the McLeod Pitch
// Method: the normalized square difference function (how alike the signal
// is to itself shifted by each lag) peaks at the period; picking the first
// strong peak, rather than the highest, avoids octave errors on bright,
// harmonic-rich sounds like a guitar. The autocorrelation it needs comes
// from an FFT, so one detection on ~85 ms of audio takes well under a
// millisecond.

export const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const NOTE_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/** In-place radix-2 FFT (length a power of two). `inverse` is unscaled. */
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
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export interface PitchReading {
  /** Hz. */
  freq: number;
  /** How periodic the sound is, 0..1 (the NSDF peak height). */
  clarity: number;
  /** RMS level of the analysed audio, dBFS. */
  levelDb: number;
}

export interface DetectOptions {
  minHz?: number;
  maxHz?: number;
  /** Below this level (dBFS), no reading. */
  gateDb?: number;
  /** Below this clarity, no reading (noise, chords). */
  minClarity?: number;
}

/** The pitch of `samples` (a mono buffer, ideally a power of two long), or
 * null when there's no clear single pitch. */
export function detectPitch(samples: Float32Array, sampleRate: number, opts: DetectOptions = {}): PitchReading | null {
  const { minHz = 30, maxHz = 2000, gateDb = -55, minClarity = 0.8 } = opts;
  const n = samples.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += samples[i];
  mean /= n;
  const x = new Float64Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    x[i] = samples[i] - mean;
    energy += x[i] * x[i];
  }
  const levelDb = 10 * Math.log10(energy / n + 1e-20);
  if (levelDb < gateDb) return null;

  // Autocorrelation via FFT (zero-padded to 2n so it doesn't wrap).
  let size = 1;
  while (size < 2 * n) size <<= 1;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  re.set(x);
  fft(re, im);
  for (let i = 0; i < size; i++) {
    re[i] = re[i] * re[i] + im[i] * im[i];
    im[i] = 0;
  }
  fft(re, im, true);

  // NSDF(tau) = 2 r(tau) / m(tau), m = sum of both windows' energy.
  const maxTau = Math.min(Math.floor(n / 2), Math.ceil(sampleRate / minHz) + 1);
  const minTau = Math.max(1, Math.floor(sampleRate / maxHz));
  const nsdf = new Float64Array(maxTau + 1);
  let m = 2 * energy;
  for (let tau = 0; tau <= maxTau; tau++) {
    if (tau > 0) m -= x[tau - 1] * x[tau - 1] + x[n - tau] * x[n - tau];
    nsdf[tau] = m > 0 ? (2 * (re[tau] / size)) / m : 0;
  }

  // Key maxima: the highest point of each positive lobe after the first
  // time the NSDF goes negative.
  const peaks: number[] = [];
  let tau = 1;
  while (tau < maxTau && nsdf[tau] > 0) tau++;
  while (tau < maxTau) {
    while (tau < maxTau && nsdf[tau] <= 0) tau++;
    let best = -1;
    while (tau < maxTau && nsdf[tau] > 0) {
      if (best < 0 || nsdf[tau] > nsdf[best]) best = tau;
      tau++;
    }
    if (best > 0 && best >= minTau) peaks.push(best);
  }
  if (!peaks.length) return null;
  const highest = Math.max(...peaks.map((p) => nsdf[p]));
  const pick = peaks.find((p) => nsdf[p] >= 0.93 * highest)!;

  // Parabolic interpolation around the peak for a sub-sample period.
  const a = nsdf[pick - 1];
  const b = nsdf[pick];
  const c = nsdf[pick + 1] ?? b;
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
  const period = pick + shift;
  const clarity = b - 0.25 * (a - c) * shift;
  if (clarity < minClarity) return null;
  const freq = sampleRate / period;
  if (freq < minHz || freq > maxHz) return null;
  return { freq, clarity, levelDb };
}

export interface NoteReading {
  /** e.g. "A", "C#". */
  name: string;
  octave: number;
  midi: number;
  /** -50..50: how far off the nearest note. */
  cents: number;
  /** That note's exact frequency. */
  targetHz: number;
}

/** The nearest note to `freq` (equal temperament, A4 = `a4`). */
export function noteFor(freq: number, a4 = 440, flats = false): NoteReading {
  const exact = 69 + 12 * Math.log2(freq / a4);
  const midi = Math.round(exact);
  const names = flats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;
  return {
    name: names[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
    midi,
    cents: (exact - midi) * 100,
    targetHz: a4 * Math.pow(2, (midi - 69) / 12),
  };
}
