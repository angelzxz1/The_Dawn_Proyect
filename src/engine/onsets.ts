// Where the notes and hits in some audio start, for quantizing it
// (warp.ts quantizedWarp): the peaks of how fast its loudness rises
// (tempoDetect.ts onsetCurve) that stand out from what's around them, each
// then placed to the millisecond by a finer look at the waveform. Pure.

import { curveFrames, onsetCurve } from "./tempoDetect";

/** Onsets closer than this (s) are one. */
const MIN_GAP = 0.05;
/** How far around (s) a peak must stand out from. */
const AROUND = 0.15;

/** Where, within ±`span` s of `near`, the signal's level rises fastest
 * (s): an onset's place to the millisecond. */
function refine(mono: Float32Array, sampleRate: number, near: number, span: number): number {
  const size = Math.max(1, Math.round(0.002 * sampleRate));
  const hop = Math.max(1, Math.round(0.0005 * sampleRate));
  const from = Math.max(0, Math.round((near - span) * sampleRate));
  const to = Math.min(mono.length - size, Math.round((near + span) * sampleRate));
  let best = near;
  let bestRise = -Infinity;
  let last: number | null = null;
  for (let i = from; i <= to; i += hop) {
    let sum = 0;
    for (let j = 0; j < size; j++) sum += mono[i + j] * mono[i + j];
    const level = Math.log(1e-9 + sum / size);
    if (last !== null && level - last > bestRise) {
      bestRise = level - last;
      best = i / sampleRate;
    }
    last = level;
  }
  return best;
}

/** The onsets in `channels` (s from their start), in order. */
export function detectOnsets(channels: Float32Array[], sampleRate: number): number[] {
  if (channels.length === 0 || channels[0].length === 0) return [];
  const seconds = channels[0].length / sampleRate;
  const curve = onsetCurve(channels, sampleRate, seconds);
  const { hop, size } = curveFrames(sampleRate);
  const step = hop / sampleRate;
  let peak = 0;
  curve.forEach((v) => (peak = Math.max(peak, v)));
  if (!(peak > 0)) return [];
  // A running sum, for the level around each step.
  const sums = new Float64Array(curve.length + 1);
  curve.forEach((v, i) => (sums[i + 1] = sums[i] + v));
  const around = Math.max(1, Math.round(AROUND / step));
  const gap = Math.max(1, Math.round(MIN_GAP / step));
  const mono = new Float32Array(channels[0].length);
  channels.forEach((ch) => ch.forEach((v, i) => (mono[i] += v)));
  const found: number[] = [];
  let lastAt = -Infinity;
  for (let k = 1; k < curve.length - 1; k++) {
    const v = curve[k];
    if (v < 0.1 * peak) continue;
    const lo = Math.max(0, k - around);
    const hi = Math.min(curve.length, k + around + 1);
    const mean = (sums[hi] - sums[lo]) / (hi - lo);
    if (v < 1.5 * mean) continue;
    // The top of its own rise (a few steps either way).
    let top = true;
    for (let j = Math.max(0, k - 3); j <= Math.min(curve.length - 1, k + 3); j++) if (curve[j] > v || (curve[j] === v && j < k)) top = false;
    if (!top || k - lastAt < gap) continue;
    lastAt = k;
    // The frame's rise peaks with the onset about its middle.
    found.push(refine(mono, sampleRate, (k * hop + size / 2) / sampleRate, size / sampleRate));
  }
  return found;
}
