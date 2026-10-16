// Finding the tempo of some audio (a loop, a recording), for warping it
// (warp.ts): how its loudness pulses. The rises in loudness (where notes
// and hits start) make a curve; the curve lines up with itself best when
// shifted by a beat, so the shift that lines up best - over the beats of
// 60 to 200 BPM, with the beats after it weighed in - is the beat. Halves
// and doubles of a tempo line up almost as well; a gentle preference for
// tempos near 120 picks between them. Pure.

/** The curve's step (s): fine enough for a tempo to a tenth of a BPM. */
const HOP_SECONDS = 0.003;
const FRAME_SECONDS = 0.023;
/** At most this much is looked at (s). */
const MAX_SECONDS = 30;
const MIN_BPM = 60;
/** A rise in loudness smaller than this (natural log of energy, about a
 * tenth of a dB) isn't a note starting. */
const MIN_RISE = 0.023;
const MAX_BPM = 200;

/** How the loudness rises over time: one value per HOP_SECONDS. */
export function onsetCurve(channels: Float32Array[], sampleRate: number): Float32Array {
  const frames = Math.min(channels[0]?.length ?? 0, Math.round(MAX_SECONDS * sampleRate));
  const hop = Math.max(1, Math.round(HOP_SECONDS * sampleRate));
  const size = Math.max(hop, Math.round(FRAME_SECONDS * sampleRate));
  // The channels together, the highs brought up (where hits start).
  const mono = new Float32Array(frames);
  channels.forEach((ch) => {
    for (let i = 0; i < frames; i++) mono[i] += ch[i];
  });
  for (let i = frames - 1; i > 0; i--) mono[i] -= 0.97 * mono[i - 1];
  // Energy over a frame (Hann-windowed, so a steady tone reads steady),
  // every hop.
  const steps = Math.max(0, Math.floor((frames - size) / hop));
  const win = new Float32Array(size);
  let winSum = 0;
  for (let j = 0; j < size; j++) winSum += win[j] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (j + 0.5)) / size);
  const energy = new Float32Array(steps);
  for (let k = 0; k < steps; k++) {
    let sum = 0;
    for (let j = 0, at = k * hop; j < size; j++, at++) sum += win[j] * mono[at] * mono[at];
    energy[k] = Math.log(1e-9 + sum / winSum);
  }
  // Rises only, and only real ones (a tenth of a dB or more).
  const curve = new Float32Array(steps);
  for (let k = 1; k < steps; k++) {
    const rise = energy[k] - energy[k - 1];
    curve[k] = rise > MIN_RISE ? rise : 0;
  }
  return curve;
}

/** How alike the curve is to itself `lag` steps on (lag may be between
 * steps). */
function selfLikeness(curve: Float32Array, mean: number, lag: number): number {
  const whole = Math.floor(lag);
  const frac = lag - whole;
  let sum = 0;
  const n = curve.length - whole - 1;
  if (n <= 0) return 0;
  for (let i = 0; i < n; i++) {
    const shifted = curve[i + whole] * (1 - frac) + curve[i + whole + 1] * frac;
    sum += (curve[i] - mean) * (shifted - mean);
  }
  return sum / n;
}

/** The tempo of `channels` (BPM, to a tenth), and how clear it is (0 to
 * 1); null with no clear pulse. */
export function detectTempo(channels: Float32Array[], sampleRate: number): { bpm: number; confidence: number } | null {
  if (channels.length === 0) return null;
  const hop = Math.max(1, Math.round(HOP_SECONDS * sampleRate)) / sampleRate;
  const curve = onsetCurve(channels, sampleRate);
  // At least four beats at the slowest tempo.
  if (curve.length * hop < (4 * 60) / MIN_BPM) return null;
  let mean = 0;
  curve.forEach((v) => (mean += v));
  mean /= curve.length;
  const likeness = new Map<number, number>();
  const at = (lag: number) => {
    const key = Math.round(lag * 4) / 4;
    let v = likeness.get(key);
    if (v === undefined) {
      v = selfLikeness(curve, mean, key);
      likeness.set(key, v);
    }
    return v;
  };
  const scores: { bpm: number; score: number }[] = [];
  for (let bpm = MIN_BPM; bpm <= MAX_BPM + 1e-9; bpm += 0.5) {
    const lag = 60 / bpm / hop;
    // The beat, and the next ones lining up too.
    const comb = at(lag) + 0.5 * at(2 * lag) + 0.25 * at(3 * lag);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    scores.push({ bpm, score: comb * (0.7 + 0.3 * prior) });
  }
  let best = scores[0];
  scores.forEach((s) => s.score > best.score && (best = s));
  if (!(best.score > 0)) return null;
  // Finer, around the best.
  let fine = best.bpm;
  let fineScore = -Infinity;
  for (let bpm = best.bpm - 0.5; bpm <= best.bpm + 0.5 + 1e-9; bpm += 0.1) {
    const lag = 60 / bpm / hop;
    const score = selfLikeness(curve, mean, lag) + 0.5 * selfLikeness(curve, mean, 2 * lag);
    if (score > fineScore) {
      fineScore = score;
      fine = bpm;
    }
  }
  // How alike the curve is a beat on, for how alike it is to itself: a
  // clear pulse comes close to 1, a steady sound or noise near 0.
  const self = selfLikeness(curve, mean, 0);
  if (!(self > 1e-12)) return null;
  const confidence = Math.max(0, Math.min(1, selfLikeness(curve, mean, 60 / fine / hop) / self));
  if (confidence < 0.15) return null;
  return { bpm: Math.round(fine * 10) / 10, confidence };
}
