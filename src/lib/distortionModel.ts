// The Distortion effect's transfer function, shared by the audio engine
// (which bakes it into a WaveShaperNode curve) and the Distortion window's
// graph (which draws the same curve and a test sine through it).

export type DistortionShape = "soft" | "hard" | "fold";
export const DISTORTION_SHAPES: DistortionShape[] = ["soft", "hard", "fold"];

export type Oversample = "none" | "2x" | "4x";
export const OVERSAMPLE_OPTIONS: { value: Oversample; label: string }[] = [
  { value: "none", label: "OS Off" },
  { value: "2x", label: "2x" },
  { value: "4x", label: "4x" },
];

export function distortionShapeFromParam(v: number): DistortionShape {
  return DISTORTION_SHAPES[Math.max(0, Math.min(2, Math.round(v)))];
}

export function oversampleFromParam(v: number): Oversample {
  return OVERSAMPLE_OPTIONS[Math.max(0, Math.min(2, Math.round(v)))].value;
}

/** Drive 0..1 as a linear input gain, x1 to x31 (about +30dB). */
export function driveGain(drive: number): number {
  return 1 + 30 * drive;
}

function shape(kind: DistortionShape, v: number): number {
  if (kind === "soft") return Math.tanh(v);
  if (kind === "hard") return Math.max(-1, Math.min(1, v));
  // Sine wavefolder: rises to 1, then folds back down instead of flattening.
  return Math.sin((Math.PI / 2) * v);
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
