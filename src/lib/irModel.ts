// Impulse-response helpers for the IR Loader: preparing an uploaded IR for
// a ConvolverNode, level-normalizing it, and measuring its frequency
// response for the plugin's graph. Pure functions - no Web Audio here.

/** Longest IR accepted, in seconds - room reverbs fit; cab IRs are ~0.1-0.5 s. */
export const MAX_IR_SECONDS = 20;

/** Knob values at or past these read "Off" (see effects.ts). */
const LOW_CUT_OFF_HZ = 20.5;
const HIGH_CUT_OFF_HZ = 19999;

/** A ConvolverNode accepts 1, 2 or 4 channel IRs (mono, stereo, true
 * stereo). Anything else is reduced to its first two channels. */
export function convolverChannels<T>(channels: T[]): T[] {
  if (channels.length === 1 || channels.length === 2 || channels.length === 4) return channels;
  return channels.slice(0, 2);
}

/** Gain that brings the IR to unit energy (averaged over its channels), so
 * broadband material comes out at about the level it went in. IRs are
 * recorded at very different levels; this makes them comparable. */
export function irNormalizationGain(channels: Float32Array[]): number {
  if (channels.length === 0) return 1;
  let energy = 0;
  channels.forEach((data) => {
    for (let i = 0; i < data.length; i++) energy += data[i] * data[i];
  });
  energy /= channels.length;
  return energy > 1e-12 ? 1 / Math.sqrt(energy) : 1;
}

/** The low-cut filter's actual corner: "Off" moves it below hearing. */
export function effectiveLowCut(value: number): number {
  return value <= LOW_CUT_OFF_HZ ? 5 : value;
}

/** The high-cut filter's actual corner: "Off" moves it to Nyquist, where a
 * Web Audio lowpass passes everything. */
export function effectiveHighCut(value: number, sampleRate: number): number {
  return value >= HIGH_CUT_OFF_HZ ? sampleRate / 2 : value;
}

/** Magnitude (dB) of the 12 dB/oct Butterworth low/high cut pair at `f`. */
export function cutFiltersDb(f: number, lowCut: number, highCut: number, sampleRate: number): number {
  const lo = effectiveLowCut(lowCut);
  const hi = effectiveHighCut(highCut, sampleRate);
  const hp = Math.pow(f / lo, 4);
  const hpGain = hp / (1 + hp);
  const lpGain = hi >= sampleRate / 2 ? 1 : 1 / (1 + Math.pow(f / hi, 4));
  return 10 * Math.log10(Math.max(1e-12, hpGain * lpGain));
}

/** In-place radix-2 FFT (re/im arrays, length a power of two). */
function fft(re: Float64Array, im: Float64Array): void {
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
    const angle = (-2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tRe = re[b] * curRe - im[b] * curIm;
        const tIm = re[b] * curIm + im[b] * curRe;
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

const ANALYSIS_MAX_SAMPLES = 65536;

/** The IR's frequency response in dB at each of `freqs`, averaged over its
 * channels and smoothed to 1/6 octave so the graph reads as a curve rather
 * than comb-filter hash. Only the first ~1.4 s is analysed (all of a cab IR;
 * the early part of a long reverb). */
export function irResponseDb(
  channels: Float32Array[],
  sampleRate: number,
  freqs: number[],
  gain = 1
): number[] {
  const length = Math.min(ANALYSIS_MAX_SAMPLES, Math.max(1, ...channels.map((c) => c.length)));
  let size = 1024;
  while (size < length) size <<= 1;
  const bins = size / 2;
  const power = new Float64Array(bins + 1);
  channels.forEach((data) => {
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (let i = 0; i < Math.min(length, data.length); i++) re[i] = data[i] * gain;
    fft(re, im);
    for (let k = 0; k <= bins; k++) power[k] += (re[k] * re[k] + im[k] * im[k]) / channels.length;
  });
  const binHz = sampleRate / size;
  const halfBand = Math.pow(2, 1 / 12);
  return freqs.map((f) => {
    const from = Math.max(0, Math.floor(f / halfBand / binHz));
    const to = Math.min(bins, Math.max(from, Math.ceil((f * halfBand) / binHz)));
    let sum = 0;
    for (let k = from; k <= to; k++) sum += power[k];
    return 10 * Math.log10(Math.max(1e-12, sum / (to - from + 1)));
  });
}
