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

/** Groups the effect palette the way an Ableton-style device browser would
 * - the sidebar renders one collapsible section per group. */
export const EFFECT_GROUPS: { name: string; types: EffectType[] }[] = [
  { name: "Dynamics", types: ["compressor", "limiter"] },
  { name: "EQ & Filter", types: ["eq3", "filter"] },
  { name: "Modulation", types: ["chorus", "pitchShift"] },
  { name: "Distortion", types: ["distortion"] },
  { name: "Reverb & Delay", types: ["reverb", "delay"] },
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
const msSpaced = (v: number) => `${Math.round(v * 1000)} ms`;
const secSpaced = (v: number) => `${v.toFixed(2)} s`;
const hzSpaced = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : `${Math.round(v)} Hz`);

const PARAM_SPECS: Record<EffectType, ParamSpec[]> = {
  eq3: [
    { key: "low", label: "Low", min: -24, max: 12, default: 0, format: db },
    { key: "mid", label: "Mid", min: -24, max: 12, default: 0, format: db },
    { key: "high", label: "High", min: -24, max: 12, default: 0, format: db },
    { key: "lowFrequency", label: "Low X", min: 60, max: 1000, default: 400, format: hz },
    { key: "highFrequency", label: "High X", min: 1000, max: 8000, default: 2500, format: hz },
  ],
  compressor: [
    { key: "threshold", label: "Threshold", min: -60, max: 0, default: -24, format: db },
    { key: "ratio", label: "Ratio", min: 1, max: 20, default: 4, format: ratio },
    { key: "attack", label: "Attack", min: 0.001, max: 0.25, default: 0.02, format: ms },
    { key: "release", label: "Release", min: 0.01, max: 1, default: 0.2, format: ms },
    { key: "knee", label: "Knee", min: 0, max: 40, default: 6, format: db },
    { key: "makeup", label: "Makeup", min: -12, max: 24, default: 0, format: db },
    { key: "makeupAuto", label: "Auto Makeup", min: 0, max: 1, default: 1, format: (v) => (v >= 0.5 ? "Auto" : "Manual") },
    { key: "dryWet", label: "Dry/Wet", min: 0, max: 1, default: 1, format: pct },
    { key: "output", label: "Output", min: -24, max: 24, default: 0, format: db },
  ],
  delay: [
    // Defaults match a dotted-eighth/eighth stereo delay at the project's
    // starting 120bpm (quarter note = 0.5s): 1/8 = 0.25s, 1/8 dotted = 0.375s.
    { key: "delayTimeL", label: "Time L", min: 0.02, max: 2, default: 0.25, format: sec },
    { key: "delayTimeR", label: "Time R", min: 0.02, max: 2, default: 0.375, format: sec },
    { key: "feedback", label: "Feedback", min: 0, max: 0.95, default: 0.45, format: pct },
    { key: "lowCut", label: "Low Cut", min: 20, max: 2000, default: 150, format: hz },
    { key: "highCut", label: "High Cut", min: 1000, max: 18000, default: 6000, format: hz },
    { key: "wet", label: "Dry/Wet", min: 0, max: 1, default: 0.3, format: pct },
    // The remaining keys are plain 0/1 toggles (matching how compressor's
    // makeupAuto works) - Sync and Link are UI-only (they change how the
    // Time L/R knobs are dragged and typed, not the audio graph itself);
    // Ping-Pong, Freeze, and Filter each have real DelayChain behavior.
    { key: "sync", label: "Sync", min: 0, max: 1, default: 1, format: (v) => (v >= 0.5 ? "Sync" : "Time") },
    { key: "link", label: "Link", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off") },
    { key: "pingPong", label: "Ping-Pong", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off") },
    { key: "freeze", label: "Freeze", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off") },
    { key: "filterOn", label: "Filter", min: 0, max: 1, default: 1, format: (v) => (v >= 0.5 ? "On" : "Off") },
  ],
  // `decay` and `wet` keep their original keys so reverbs saved before this
  // plugin existed still load with their settings.
  reverb: [
    { key: "preDelay", label: "Pre-Delay", min: 0, max: 0.25, default: 0, format: msSpaced },
    { key: "decay", label: "Decay", min: 0.2, max: 10, default: 1.2, format: secSpaced },
    { key: "damping", label: "Damping", min: 1000, max: 20000, default: 4700, format: hzSpaced },
    { key: "early", label: "Early", min: 0, max: 1, default: 0.8, format: pct },
    { key: "lowCut", label: "Low Cut", min: 20, max: 2000, default: 650, format: hzSpaced },
    { key: "highCut", label: "High Cut", min: 1000, max: 20000, default: 5000, format: hzSpaced },
    { key: "width", label: "Width", min: 0, max: 1, default: 1, format: pct },
    { key: "wet", label: "Dry/Wet", min: 0, max: 1, default: 0.25, format: pct },
    // 0 = Hall, 1 = Room, 2 = Plate (see reverbModel.ts).
    { key: "mode", label: "Mode", min: 0, max: 2, default: 0, format: (v) => ["Hall", "Room", "Plate"][Math.round(v)] ?? "Hall" },
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

/** A standard "half the average gain reduction" heuristic for automatic
 * makeup gain: at signal levels well above threshold, a compressor at this
 * ratio reduces gain by `-threshold * (1 - 1/ratio)` dB, and this recovers
 * roughly half of that. Shared by the audio engine (to actually apply it)
 * and the Compressor UI (to display the live "AUTO +N dB" readout) so both
 * always agree without the UI having to poll the engine. */
export function autoMakeupDb(threshold: number, ratio: number): number {
  const reduction = -threshold * (1 - 1 / ratio);
  return Math.max(0, Math.min(24, reduction / 2));
}
