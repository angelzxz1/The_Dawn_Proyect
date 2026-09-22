// Effect type/param definitions shared by the audio engine and the FX
// window UI. Every effect's live params are plain numbers so a single
// generic ValueBar-driven UI can drive any of them.

export type EffectType =
  | "eq3"
  | "compressor"
  | "delay"
  | "reverb"
  | "chorus"
  | "distortion"
  | "filter"
  | "limiter"
  | "pitchShift";

export const EFFECT_TYPES: EffectType[] = [
  "eq3",
  "compressor",
  "delay",
  "reverb",
  "chorus",
  "distortion",
  "filter",
  "limiter",
  "pitchShift",
];

export const EFFECT_LABELS: Record<EffectType, string> = {
  eq3: "EQ Three",
  compressor: "Compressor",
  delay: "Delay",
  reverb: "Reverb",
  chorus: "Chorus",
  distortion: "Distortion",
  filter: "Filter",
  limiter: "Limiter",
  pitchShift: "Pitch Shift",
};

export interface EffectInstance {
  id: string;
  type: EffectType;
  params: Record<string, number>;
  /** Skipped in the signal chain (as if unplugged) without losing its
   * params or its position in the chain, so it can be flipped back on. */
  bypass?: boolean;
}

export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  format: (v: number) => string;
}

const db = (v: number) => `${v.toFixed(1)}dB`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const ms = (v: number) => `${Math.round(v * 1000)}ms`;
const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}Hz`);
const ratio = (v: number) => `${v.toFixed(1)}:1`;
const sec = (v: number) => `${v.toFixed(2)}s`;
const semi = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}st`;
const plain = (v: number) => v.toFixed(1);

const PARAM_SPECS: Record<EffectType, ParamSpec[]> = {
  eq3: [
    { key: "low", label: "Low", min: -24, max: 12, default: 0, format: db },
    { key: "mid", label: "Mid", min: -24, max: 12, default: 0, format: db },
    { key: "high", label: "High", min: -24, max: 12, default: 0, format: db },
    { key: "lowFrequency", label: "Low X", min: 60, max: 1000, default: 400, format: hz },
    { key: "highFrequency", label: "High X", min: 1000, max: 8000, default: 2500, format: hz },
  ],
  compressor: [
    { key: "threshold", label: "Thresh", min: -60, max: 0, default: -24, format: db },
    { key: "ratio", label: "Ratio", min: 1, max: 20, default: 4, format: ratio },
    { key: "attack", label: "Attack", min: 0.001, max: 0.25, default: 0.02, format: ms },
    { key: "release", label: "Release", min: 0.01, max: 1, default: 0.2, format: ms },
  ],
  delay: [
    { key: "delayTime", label: "Time", min: 0.02, max: 1, default: 0.25, format: sec },
    { key: "feedback", label: "Feedback", min: 0, max: 0.9, default: 0.35, format: pct },
    { key: "wet", label: "Mix", min: 0, max: 1, default: 0.35, format: pct },
  ],
  reverb: [
    { key: "decay", label: "Decay", min: 0.1, max: 8, default: 2, format: sec },
    { key: "wet", label: "Mix", min: 0, max: 1, default: 0.3, format: pct },
  ],
  chorus: [
    { key: "frequency", label: "Rate", min: 0.1, max: 10, default: 1.5, format: hz },
    { key: "delayTime", label: "Delay", min: 1, max: 20, default: 3.5, format: ms },
    { key: "depth", label: "Depth", min: 0, max: 1, default: 0.7, format: pct },
    { key: "wet", label: "Mix", min: 0, max: 1, default: 0.5, format: pct },
  ],
  distortion: [
    { key: "distortion", label: "Drive", min: 0, max: 1, default: 0.4, format: pct },
    { key: "wet", label: "Mix", min: 0, max: 1, default: 1, format: pct },
  ],
  filter: [
    { key: "frequency", label: "Cutoff", min: 40, max: 12000, default: 1200, format: hz },
    { key: "Q", label: "Reso", min: 0.1, max: 20, default: 1, format: plain },
    // 0 = lowpass, 0.5 = highpass, 1 = bandpass - a single knob so the
    // generic ValueBar UI (numbers only, no dropdowns) can still drive it.
    { key: "type", label: "Type", min: 0, max: 1, default: 0, format: plain },
  ],
  limiter: [{ key: "threshold", label: "Ceiling", min: -30, max: 0, default: -3, format: db }],
  pitchShift: [
    { key: "pitch", label: "Pitch", min: -24, max: 24, default: 0, format: semi },
    { key: "wet", label: "Mix", min: 0, max: 1, default: 1, format: pct },
  ],
};

export function paramSpecs(type: EffectType): ParamSpec[] {
  return PARAM_SPECS[type];
}

export function defaultParams(type: EffectType): Record<string, number> {
  return Object.fromEntries(paramSpecs(type).map((s) => [s.key, s.default]));
}
