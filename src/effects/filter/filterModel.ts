// The Filter effect's design math, shared by the audio engine (which builds
// the actual BiquadFilterNode stages) and the Filter window's graph (which
// draws the exact response those stages produce, using the Web Audio spec's
// own biquad formulas).

export type FilterMode = "lowpass" | "highpass" | "bandpass" | "notch" | "peaking" | "lowshelf" | "highshelf";

/** Stored as the `mode` param's index. */
export const FILTER_MODES: { mode: FilterMode; label: string }[] = [
  { mode: "lowpass", label: "LP" },
  { mode: "highpass", label: "HP" },
  { mode: "bandpass", label: "BP" },
  { mode: "notch", label: "Notch" },
  { mode: "peaking", label: "Peak" },
  { mode: "lowshelf", label: "Low Sh" },
  { mode: "highshelf", label: "High Sh" },
];

/** Stored as the `slope` param's index: 12, 24 or 48 dB/octave. */
export const FILTER_SLOPES = [12, 24, 48];

export function filterModeFromParam(v: number): FilterMode {
  return FILTER_MODES[Math.max(0, Math.min(FILTER_MODES.length - 1, Math.round(v)))].mode;
}

export function slopeIndexFromParam(v: number): number {
  return Math.max(0, Math.min(FILTER_SLOPES.length - 1, Math.round(v)));
}

/** Peak and the shelves are shaped by Gain; the rest ignore it. */
export function filterUsesGain(mode: FilterMode): boolean {
  return mode === "peaking" || mode === "lowshelf" || mode === "highshelf";
}

/** Cascading a peak/shelf would multiply its gain rather than steepen it, so
 * slope only applies to the cut/pass types. */
export function filterUsesSlope(mode: FilterMode): boolean {
  return !filterUsesGain(mode);
}

/** How far (in octaves each way) the LFO sweeps the cutoff at 100% depth. */
export const LFO_MAX_OCTAVES = 3;

export interface FilterStage {
  type: FilterMode;
  frequency: number;
  /** The value to set on the native node's Q param - note the Web Audio
   * spec reads it in dB for lowpass/highpass, linearly otherwise. */
  nativeQ: number;
  gain: number;
}

const SQRT1_2 = Math.SQRT1_2;

/** Q of each 2nd-order section of an order-`n` Butterworth filter. */
function butterworthQs(order: number): number[] {
  const qs: number[] = [];
  for (let k = 1; k <= order / 2; k++) qs.push(1 / (2 * Math.cos(((2 * k - 1) * Math.PI) / (2 * order))));
  return qs;
}

/** The biquad stages for a setting. Steeper LP/HP slopes are real
 * Butterworth cascades (flat passband) with the resonance applied to the
 * section that sets the corner, rather than N copies of the same resonant
 * section - which would stack the resonance peak N times over. */
export function designFilter(
  mode: FilterMode,
  frequency: number,
  q: number,
  gainDb: number,
  slopeIndex: number
): FilterStage[] {
  if (filterUsesGain(mode)) return [{ type: mode, frequency, nativeQ: q, gain: gainDb }];
  const sections = Math.pow(2, slopeIndex); // 12 -> 1, 24 -> 2, 48 -> 4
  if (mode === "lowpass" || mode === "highpass") {
    const qs = butterworthQs(sections * 2);
    const peak = qs.length - 1;
    return qs.map((bq, i) => {
      const linearQ = i === peak ? bq * (q / SQRT1_2) : bq;
      return { type: mode, frequency, nativeQ: 20 * Math.log10(linearQ), gain: 0 };
    });
  }
  return Array.from({ length: sections }, () => ({ type: mode, frequency, nativeQ: q, gain: 0 }));
}

interface Coefficients {
  b0: number;
  b1: number;
  b2: number;
  a0: number;
  a1: number;
  a2: number;
}

/** The Web Audio spec's BiquadFilterNode coefficients. */
function coefficients(stage: FilterStage, sampleRate: number): Coefficients {
  const f0 = Math.min(stage.frequency, sampleRate / 2);
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const A = Math.pow(10, stage.gain / 40);
  const alphaQ = sin / (2 * stage.nativeQ);
  const alphaQdB = sin / (2 * Math.pow(10, stage.nativeQ / 20));
  const alphaS = (sin / 2) * Math.SQRT2; // shelf slope S = 1
  const sqA = Math.sqrt(A);
  switch (stage.type) {
    case "lowpass":
      return { b0: (1 - cos) / 2, b1: 1 - cos, b2: (1 - cos) / 2, a0: 1 + alphaQdB, a1: -2 * cos, a2: 1 - alphaQdB };
    case "highpass":
      return { b0: (1 + cos) / 2, b1: -(1 + cos), b2: (1 + cos) / 2, a0: 1 + alphaQdB, a1: -2 * cos, a2: 1 - alphaQdB };
    case "bandpass":
      return { b0: alphaQ, b1: 0, b2: -alphaQ, a0: 1 + alphaQ, a1: -2 * cos, a2: 1 - alphaQ };
    case "notch":
      return { b0: 1, b1: -2 * cos, b2: 1, a0: 1 + alphaQ, a1: -2 * cos, a2: 1 - alphaQ };
    case "peaking":
      return { b0: 1 + alphaQ * A, b1: -2 * cos, b2: 1 - alphaQ * A, a0: 1 + alphaQ / A, a1: -2 * cos, a2: 1 - alphaQ / A };
    case "lowshelf":
      return {
        b0: A * (A + 1 - (A - 1) * cos + 2 * alphaS * sqA),
        b1: 2 * A * (A - 1 - (A + 1) * cos),
        b2: A * (A + 1 - (A - 1) * cos - 2 * alphaS * sqA),
        a0: A + 1 + (A - 1) * cos + 2 * alphaS * sqA,
        a1: -2 * (A - 1 + (A + 1) * cos),
        a2: A + 1 + (A - 1) * cos - 2 * alphaS * sqA,
      };
    case "highshelf":
      return {
        b0: A * (A + 1 + (A - 1) * cos + 2 * alphaS * sqA),
        b1: -2 * A * (A - 1 + (A + 1) * cos),
        b2: A * (A + 1 + (A - 1) * cos - 2 * alphaS * sqA),
        a0: A + 1 - (A - 1) * cos + 2 * alphaS * sqA,
        a1: 2 * (A - 1 - (A + 1) * cos),
        a2: A + 1 - (A - 1) * cos - 2 * alphaS * sqA,
      };
  }
}

/** Magnitude (dB) of the whole effect at `frequency`: the stages in series,
 * blended with the dry signal by `wet` (a complex sum, so phase counts). */
export function filterResponseDb(stages: FilterStage[], wet: number, frequency: number, sampleRate: number): number {
  const w = (2 * Math.PI * frequency) / sampleRate;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  let re = 1;
  let im = 0;
  for (const stage of stages) {
    const k = coefficients(stage, sampleRate);
    const nr = k.b0 + k.b1 * c1 + k.b2 * c2;
    const ni = -(k.b1 * s1 + k.b2 * s2);
    const dr = k.a0 + k.a1 * c1 + k.a2 * c2;
    const di = -(k.a1 * s1 + k.a2 * s2);
    const d = dr * dr + di * di;
    const hr = (nr * dr + ni * di) / d;
    const hi = (ni * dr - nr * di) / d;
    const r = re * hr - im * hi;
    im = re * hi + im * hr;
    re = r;
  }
  const outRe = 1 - wet + wet * re;
  const outIm = wet * im;
  return 10 * Math.log10(outRe * outRe + outIm * outIm + 1e-30);
}

/** Converts a filter saved before the plugin UI existed: its single 0..1
 * "type" knob (< 0.33 lowpass, < 0.67 highpass, else bandpass) becomes
 * `mode`, and since Tone.Filter handed Q straight to the native node - which
 * reads it in dB for lowpass/highpass - that Q is turned into the linear Q
 * the Reso knob now uses, so the old setting sounds the same. */
export function migrateLegacyFilterParams(params: Record<string, number>): Record<string, number> {
  if (params.type === undefined || params.mode !== undefined) return params;
  const { type, ...rest } = params;
  const mode = legacyFilterTypeToMode(type);
  const migrated: Record<string, number> = { ...rest, mode };
  if (mode !== 2 && rest.Q !== undefined) migrated.Q = Math.pow(10, rest.Q / 20);
  return migrated;
}

/** An old automation point on the legacy "type" knob, as a `mode` index. */
export function legacyFilterTypeToMode(type: number): number {
  return type < 0.33 ? 0 : type < 0.67 ? 1 : 2;
}
