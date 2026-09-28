// The Saturator's (the "distortion" effect's) math, shared by the audio
// engine (which bakes the curve into a WaveShaperNode and builds the color
// EQ from biquads) and the window's graphs (which draw the same curve, a
// test sine through it, and the color EQ's response).
//
// Curves, like Live's Saturator: Analog Clip (tanh - smooth, the classic
// warm clip), Soft Sine (a sine segment that flattens at full scale),
// Medium and Hard Curve (softer and harder knees), Sinoid Fold (folds back
// instead of flattening) and Digital Clip (a hard ceiling). The first three
// in the param's order are the effect's original Soft/Hard/Fold, so saved
// projects sound the same.

export type DistortionShape = "analog" | "digital" | "fold" | "softSine" | "medium" | "hard";
/** In the `shape` param's order (0..5). */
export const DISTORTION_SHAPES: DistortionShape[] = ["analog", "digital", "fold", "softSine", "medium", "hard"];
/** The order the window lists them in: gentlest to harshest, then fold. */
export const SHAPE_ORDER: DistortionShape[] = ["analog", "softSine", "medium", "hard", "digital", "fold"];
export const SHAPE_LABELS: Record<DistortionShape, string> = {
  analog: "Analog Clip",
  softSine: "Soft Sine",
  medium: "Medium Curve",
  hard: "Hard Curve",
  digital: "Digital Clip",
  fold: "Sinoid Fold",
};

export type Oversample = "none" | "2x" | "4x";
export const OVERSAMPLE_OPTIONS: { value: Oversample; label: string }[] = [
  { value: "none", label: "OS Off" },
  { value: "2x", label: "2x" },
  { value: "4x", label: "4x" },
];

export function distortionShapeFromParam(v: number): DistortionShape {
  return DISTORTION_SHAPES[Math.max(0, Math.min(DISTORTION_SHAPES.length - 1, Math.round(v)))] ?? "analog";
}

export function oversampleFromParam(v: number): Oversample {
  return OVERSAMPLE_OPTIONS[Math.max(0, Math.min(2, Math.round(v)))].value;
}

/** Drive 0..1 as a linear input gain, x1 to x31 (about +30dB). */
export function driveGain(drive: number): number {
  return 1 + 30 * drive;
}

function shape(kind: DistortionShape, v: number): number {
  switch (kind) {
    case "analog":
      return Math.tanh(v);
    case "digital":
      return Math.max(-1, Math.min(1, v));
    case "softSine":
      // A quarter sine, unity gain for small signals, flat from full scale.
      return Math.abs(v) < Math.PI / 2 ? Math.sin(v) : Math.sign(v);
    case "medium":
      return v / Math.sqrt(1 + v * v);
    case "hard":
      return v / Math.pow(1 + Math.pow(Math.abs(v), 6), 1 / 6);
    case "fold":
      // Rises to 1, then folds back down instead of flattening.
      return Math.sin((Math.PI / 2) * v);
  }
}

/** The effect's static transfer curve for an input sample `x`: gain, then
 * the Bias offset (which makes the curve asymmetric - even harmonics),
 * then the shape. Shifted so silence stays silent; the engine also
 * high-passes the output to remove the DC a biased waveform picks up. */
export function distortionTransfer(kind: DistortionShape, drive: number, bias: number, x: number): number {
  return shape(kind, driveGain(drive) * x + bias) - shape(kind, bias);
}

/** Inputs up to this level (+12dB) map through the curve rather than being
 * clamped at its ends, since the waveshaper's domain is only -1..1. */
export const CURVE_HEADROOM = 4;
const CURVE_POINTS = 16385;

/** The WaveShaperNode curve: its -1..1 domain covers input -4..4 (the
 * engine scales the input by 1/CURVE_HEADROOM first). */
export function distortionCurve(kind: DistortionShape, drive: number, bias: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) {
    const u = (i / (CURVE_POINTS - 1)) * 2 - 1;
    curve[i] = distortionTransfer(kind, drive, bias, u * CURVE_HEADROOM);
  }
  return curve;
}

// --- Soft Clip: a gentle ceiling on the output ---

/** Linear up to -6 dB, then bends smoothly toward 0 dB (never past it). */
export function softClip(x: number): number {
  const a = Math.abs(x);
  return a <= 0.5 ? x : Math.sign(x) * (0.5 + 0.5 * Math.tanh((a - 0.5) / 0.5));
}

export function softClipCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) curve[i] = softClip(((i / (CURVE_POINTS - 1)) * 2 - 1) * CURVE_HEADROOM);
  return curve;
}

// --- Color EQ ---
//
// A low shelf (Base) and a bell (Frequency, Width, Depth). Pre shapes what
// gets saturated (boost the mids and they break up first); Post shapes the
// result; Emphasis boosts before and cuts the same after, so the tone stays
// put and only what the saturation grabs changes.

export const COLOR_MODES = ["pre", "post", "emphasis"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];
export const COLOR_MODE_LABELS: Record<ColorMode, string> = { pre: "Pre", post: "Post", emphasis: "Emphasis" };
/** The Base shelf's corner. */
export const COLOR_SHELF_HZ = 250;

export interface ColorSettings {
  on: boolean;
  mode: ColorMode;
  baseDb: number;
  freq: number;
  q: number;
  depthDb: number;
}

export function colorSettingsFromParams(params: Record<string, number>): ColorSettings {
  return {
    on: (params.colorOn ?? 0) >= 0.5,
    mode: COLOR_MODES[Math.max(0, Math.min(2, Math.round(params.colorMode ?? 0)))],
    baseDb: params.colorBase ?? 0,
    freq: params.colorFreq ?? 1000,
    q: params.colorQ ?? 0.7,
    depthDb: params.colorDepth ?? 0,
  };
}

/** The gains (dB) the pre and post shelf/bell get. */
export function colorGains(c: ColorSettings): { pre: { base: number; depth: number }; post: { base: number; depth: number } } {
  const on = { base: c.on ? c.baseDb : 0, depth: c.on ? c.depthDb : 0 };
  const off = { base: 0, depth: 0 };
  if (c.mode === "post") return { pre: off, post: on };
  if (c.mode === "emphasis") return { pre: on, post: { base: -on.base, depth: -on.depth } };
  return { pre: on, post: off };
}

/** Magnitude (dB) of an RBJ low shelf (slope 1) or peaking biquad - the
 * same filters the browser's BiquadFilterNode runs - at `f` Hz. */
export function biquadDb(type: "lowshelf" | "peaking", f0: number, q: number, gainDb: number, f: number, sr: number): number {
  if (Math.abs(gainDb) < 1e-9) return 0;
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * Math.min(f0, sr * 0.49)) / sr;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (type === "peaking") {
    const alpha = sin / (2 * q);
    [b0, b1, b2, a0, a1, a2] = [1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A];
  } else {
    // Shelf slope S = 1.
    const alpha = (sin / 2) * Math.SQRT2;
    const sq = 2 * Math.sqrt(A) * alpha;
    b0 = A * (A + 1 - (A - 1) * cos + sq);
    b1 = 2 * A * (A - 1 - (A + 1) * cos);
    b2 = A * (A + 1 - (A - 1) * cos - sq);
    a0 = A + 1 + (A - 1) * cos + sq;
    a1 = -2 * (A - 1 + (A + 1) * cos);
    a2 = A + 1 + (A - 1) * cos - sq;
  }
  const w = (2 * Math.PI * f) / sr;
  const mag = (c0: number, c1: number, c2: number) => {
    const re = c0 + c1 * Math.cos(w) + c2 * Math.cos(2 * w);
    const im = -(c1 * Math.sin(w) + c2 * Math.sin(2 * w));
    return Math.hypot(re, im);
  };
  return 20 * Math.log10(mag(b0, b1, b2) / mag(a0, a1, a2));
}

/** The color EQ's pre and post response (dB) at `f`. */
export function colorResponse(c: ColorSettings, f: number, sr: number): { pre: number; post: number } {
  const g = colorGains(c);
  const at = (s: { base: number; depth: number }) =>
    biquadDb("lowshelf", COLOR_SHELF_HZ, Math.SQRT1_2, s.base, f, sr) + biquadDb("peaking", c.freq, c.q, s.depth, f, sr);
  return { pre: at(g.pre), post: at(g.post) };
}
