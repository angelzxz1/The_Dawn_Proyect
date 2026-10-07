// Effect type/param definitions shared by the audio engine and the FX
// window UI. Every effect's live params are plain numbers so a single
// generic ValueBar-driven UI can drive any of them.

import {
  EQ_PLACEMENTS,
  EQ_PLACEMENT_LABELS,
  EQ_SHAPES,
  EQ_SHAPE_LABELS,
  MAX_EQ_BANDS,
  defaultBandFreq,
} from "./parametric-eq/paramEqModel";
import type { PresetRef } from "./presets";
import { COLOR_MODES, COLOR_MODE_LABELS, DISTORTION_SHAPES, SHAPE_LABELS, distortionShapeFromParam } from "./saturator/saturatorModel";
import { AMP_DEFAULTS, AMP_MODES, AMP_MODE_LABELS, AMP_RECTIFIER_LABELS, ampMode, ampRectifier } from "./furnace/ampModel";
import { GLUE_ATTACKS_MS, GLUE_AUTO_RELEASE, GLUE_RATIOS, formatGlueAttack, formatGlueRelease, glueRatio } from "./glue/glueModel";
import { MBD_BANDS, MBD_BAND_LABELS, MBD_FIELD_DEFAULTS, MBD_MIN_DB, formatMbdRatio, mbdKey } from "./multiband-dynamics/mbDynamicsModel";
import { SC_HPF_OFF, SC_LPF_OFF, type SidechainRouting } from "./sidechain/sidechainModel";
import { UTILITY_CHANNEL_LABELS, UTILITY_CHANNEL_MODES, UTILITY_GAIN_FLOOR } from "./utility/utilityModel";
import {
  MB_BAND_DEFAULTS,
  MB_DEFAULT_BANDS,
  MB_DEFAULT_CROSSOVERS,
  MB_MAX_BANDS,
  MB_MODES,
  MB_MODE_LABELS,
  mbBandCount,
} from "./multiband/multibandModel";

export type EffectType =
  | "eq3"
  | "compressor"
  | "delay"
  | "reverb"
  | "chorus"
  | "distortion"
  | "filter"
  | "limiter"
  | "pitchShift"
  | "irLoader"
  | "namAmp"
  | "tubeAmp"
  | "gate"
  | "paramEq"
  | "multiband"
  | "utility"
  | "tuner"
  | "glue"
  | "mbDynamics";

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
  "irLoader",
  "namAmp",
  "tubeAmp",
  "gate",
  "paramEq",
  "multiband",
  "utility",
  "tuner",
  "glue",
  "mbDynamics",
];

/** Groups the effect palette the way an Ableton-style device browser would
 * - the sidebar renders one collapsible section per group. */
export const EFFECT_GROUPS: { name: string; types: EffectType[] }[] = [
  { name: "Dynamics", types: ["compressor", "glue", "multiband", "mbDynamics", "limiter", "gate"] },
  { name: "EQ & Filter", types: ["paramEq", "eq3", "filter"] },
  { name: "Modulation", types: ["chorus", "pitchShift"] },
  { name: "Distortion", types: ["distortion"] },
  { name: "Reverb & Delay", types: ["reverb", "delay"] },
  { name: "Amp & Cab", types: ["tubeAmp", "namAmp", "irLoader"] },
  { name: "Utilities", types: ["utility", "tuner"] },
];

export const EFFECT_LABELS: Record<EffectType, string> = {
  eq3: "EQ Three",
  compressor: "Compressor",
  delay: "Delay",
  reverb: "Reverb",
  chorus: "Chorus",
  distortion: "Saturator",
  filter: "Filter",
  limiter: "Limiter",
  pitchShift: "Pitch Shift",
  irLoader: "IR Loader",
  namAmp: "NAM Amp",
  tubeAmp: "Furnace",
  gate: "Noise Gate",
  paramEq: "Parametric EQ",
  multiband: "Multiband Compressor",
  utility: "Utility",
  tuner: "Tuner",
  glue: "Glue Compressor",
  mbDynamics: "Multiband Dynamics",
};

/** Effect types whose detector can listen to another track (a sidechain). */
export const SIDECHAIN_EFFECT_TYPES: EffectType[] = ["compressor", "glue", "gate", "multiband", "mbDynamics"];

export function hasSidechain(type: EffectType): boolean {
  return SIDECHAIN_EFFECT_TYPES.includes(type);
}

/** Effect types that take an uploaded file (an impulse response, ...) in
 * addition to their knobs. */
export const FILE_EFFECT_TYPES: EffectType[] = ["irLoader", "namAmp"];

/** An uploaded file an effect uses. The file itself is stored alongside the
 * project's audio (see effectFiles.ts); the effect only keeps a reference. */
export interface EffectFileRef {
  id: string;
  /** The uploaded file's name, shown in the plugin. */
  name: string;
}

export interface EffectInstance {
  id: string;
  type: EffectType;
  params: Record<string, number>;
  /** Skipped in the signal chain (as if unplugged) without losing its
   * params or its position in the chain, so it can be flipped back on. */
  bypass?: boolean;
  /** Only for FILE_EFFECT_TYPES - absent until a file is loaded. */
  file?: EffectFileRef;
  /** Only for SIDECHAIN_EFFECT_TYPES - absent until one is set up. */
  sidechain?: SidechainRouting;
  /** The preset it was last loaded from or saved as (see presets.ts). */
  preset?: PresetRef;
}

export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  format: (v: number) => string;
  /** False for settings that aren't continuous (a filter shape, a view
   * option) - they're left out of the automation lane's target list. */
  automatable?: boolean;
}

const db = (v: number) => `${v.toFixed(1)}dB`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const ms = (v: number) => `${Math.round(v * 1000)}ms`;
const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}Hz`);
const ratio = (v: number) => `${v.toFixed(1)}:1`;
const sec = (v: number) => `${v.toFixed(2)}s`;
const msSpaced = (v: number) => `${Math.round(v * 1000)} ms`;
const secSpaced = (v: number) => `${v.toFixed(2)} s`;
const dbSpaced = (v: number) => `${v.toFixed(1)} dB`;
const dbSigned = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
const hzSpaced =(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : `${Math.round(v)} Hz`);
const tenths = (v: number) => v.toFixed(1);

/** The sidechain's own settings, shared by every dynamics effect. They
 * shape what the detector hears, whether or not another track is keying
 * it. */
const SIDECHAIN_SPECS: ParamSpec[] = [
  { key: "scGain", label: "Sidechain Gain", min: -24, max: 24, default: 0, format: dbSigned },
  { key: "scHpf", label: "Sidechain Low Cut", min: SC_HPF_OFF, max: 2000, default: SC_HPF_OFF, format: (v) => (v <= SC_HPF_OFF + 0.5 ? "Off" : hzSpaced(v)) },
  { key: "scLpf", label: "Sidechain High Cut", min: 200, max: SC_LPF_OFF, default: SC_LPF_OFF, format: (v) => (v >= SC_LPF_OFF - 1 ? "Off" : hzSpaced(v)) },
  { key: "scListen", label: "Sidechain Listen", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off"), automatable: false },
];

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
    ...SIDECHAIN_SPECS,
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
  // frequency/delayTime/depth/wet keep their original keys (and meanings)
  // so choruses saved before this plugin keep their sound.
  chorus: [
    { key: "frequency", label: "Rate", min: 0.05, max: 10, default: 1.5, format: (v) => `${v.toFixed(2)} Hz` },
    { key: "delayTime", label: "Delay", min: 1, max: 20, default: 3.5, format: (v) => `${v.toFixed(1)} ms` },
    { key: "depth", label: "Depth", min: 0, max: 1, default: 0.7, format: pct },
    { key: "feedback", label: "Feedback", min: 0, max: 0.9, default: 0, format: pct },
    { key: "spread", label: "Spread", min: 0, max: 180, default: 180, format: (v) => `${Math.round(v)}°` },
    { key: "wet", label: "Dry/Wet", min: 0, max: 1, default: 0.5, format: pct },
    // 0 = sine, 1 = triangle.
    { key: "waveform", label: "Waveform", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "Triangle" : "Sine") },
  ],
  // The Saturator. `distortion` (Drive), `wet` and the first three shapes
  // keep their original keys and meanings so saved distortions load and
  // sound the same.
  distortion: [
    { key: "distortion", label: "Drive", min: 0, max: 1, default: 0.3, format: (v) => `+${(20 * Math.log10(1 + 30 * v)).toFixed(1)} dB` },
    { key: "bias", label: "Bias", min: 0, max: 1, default: 0, format: pct },
    { key: "tone", label: "Tone", min: 200, max: 20000, default: 8000, format: hzSpaced },
    { key: "output", label: "Output", min: -24, max: 12, default: 0, format: dbSigned },
    { key: "wet", label: "Dry/Wet", min: 0, max: 1, default: 1, format: pct },
    // See saturatorModel.ts for the curves; oversample 0..2 = off, 2x, 4x.
    { key: "shape", label: "Curve", min: 0, max: DISTORTION_SHAPES.length - 1, default: 0, format: (v) => SHAPE_LABELS[distortionShapeFromParam(v)], automatable: false },
    { key: "oversample", label: "Oversampling", min: 0, max: 2, default: 1, format: (v) => ["Off", "2x", "4x"][Math.round(v)] ?? "Off" },
    { key: "softClip", label: "Soft Clip", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off"), automatable: false },
    { key: "colorOn", label: "Color", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off"), automatable: false },
    { key: "colorMode", label: "Color Mode", min: 0, max: 2, default: 0, format: (v) => COLOR_MODE_LABELS[COLOR_MODES[Math.round(v)]] ?? "Pre", automatable: false },
    { key: "colorBase", label: "Color Base", min: -15, max: 15, default: 0, format: dbSigned },
    { key: "colorFreq", label: "Color Freq", min: 40, max: 16000, default: 1000, format: hzSpaced },
    { key: "colorQ", label: "Color Width", min: 0.3, max: 6, default: 0.7, format: (v) => `Q ${v.toFixed(2)}` },
    { key: "colorDepth", label: "Color Depth", min: -15, max: 15, default: 0, format: dbSigned },
  ],
  // `frequency` and `Q` keep their original keys. Older projects' single
  // 0..1 "type" knob is migrated to `mode` on load (see filterModel.ts).
  filter: [
    { key: "frequency", label: "Cutoff", min: 20, max: 20000, default: 1200, format: hzSpaced },
    { key: "Q", label: "Reso", min: 0.1, max: 20, default: 1, format: (v) => `Q ${v.toFixed(2)}` },
    { key: "gain", label: "Gain", min: -24, max: 24, default: 0, format: dbSigned },
    { key: "lfoRate", label: "LFO Rate", min: 0.05, max: 20, default: 1, format: (v) => `${v.toFixed(2)} Hz` },
    { key: "lfoDepth", label: "LFO Depth", min: 0, max: 1, default: 0, format: pct },
    { key: "wet", label: "Dry/Wet", min: 0, max: 1, default: 1, format: pct },
    // 0..6 = LP, HP, BP, Notch, Peak, Low Shelf, High Shelf; slope 0..2 =
    // 12/24/48 dB per octave (see filterModel.ts).
    { key: "mode", label: "Type", min: 0, max: 6, default: 0, format: (v) => ["LP", "HP", "BP", "Notch", "Peak", "Low Shelf", "High Shelf"][Math.round(v)] ?? "LP" },
    { key: "slope", label: "Slope", min: 0, max: 2, default: 0, format: (v) => `${[12, 24, 48][Math.round(v)] ?? 12} dB/oct` },
  ],
  // `threshold` keeps its original key (it's the Ceiling) so limiters saved
  // before this plugin existed still load with their setting.
  limiter: [
    { key: "gain", label: "Gain", min: -12, max: 24, default: 0, format: dbSigned },
    { key: "threshold", label: "Ceiling", min: -30, max: 0, default: -0.3, format: dbSpaced },
    { key: "release", label: "Release", min: 0.001, max: 1, default: 0.05, format: msSpaced },
    { key: "softClip", label: "Soft Clip", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off") },
  ],
  // pitch/wet keep their original keys so saved pitch shifters load.
  pitchShift: [
    { key: "pitch", label: "Pitch", min: -24, max: 24, default: 0, format: (v) => `${Math.round(v) > 0 ? "+" : ""}${Math.round(v)} st` },
    { key: "fine", label: "Fine", min: -100, max: 100, default: 0, format: (v) => `${Math.round(v) > 0 ? "+" : ""}${Math.round(v)} ct` },
    { key: "window", label: "Window", min: 0.02, max: 0.25, default: 0.1, format: msSpaced },
    { key: "feedback", label: "Feedback", min: 0, max: 0.9, default: 0, format: pct },
    { key: "wet", label: "Dry/Wet", min: 0, max: 1, default: 1, format: pct },
  ],
  // Low/High Cut at their extremes (20 Hz / 20 kHz) are effectively off.
  irLoader: [
    { key: "lowCut", label: "Low Cut", min: 20, max: 500, default: 20, format: (v) => (v <= 20.5 ? "Off" : hzSpaced(v)) },
    { key: "highCut", label: "High Cut", min: 1000, max: 20000, default: 20000, format: (v) => (v >= 19999 ? "Off" : hzSpaced(v)) },
    { key: "output", label: "Output", min: -24, max: 24, default: 0, format: dbSigned },
    { key: "wet", label: "Dry/Wet", min: 0, max: 1, default: 1, format: pct },
    { key: "normalize", label: "Normalize", min: 0, max: 1, default: 1, format: (v) => (v >= 0.5 ? "On" : "Off") },
  ],
  // Mirrors the official NAM plugin: Input/Output in dB, a Bass/Middle/
  // Treble tone stack on 0-10 knobs (5 = flat), output normalized to the
  // model's reported loudness, and A2 models' Full/Lite size.
  namAmp: [
    { key: "input", label: "Input", min: -20, max: 20, default: 0, format: dbSigned },
    { key: "bass", label: "Bass", min: 0, max: 10, default: 5, format: (v) => v.toFixed(1) },
    { key: "middle", label: "Middle", min: 0, max: 10, default: 5, format: (v) => v.toFixed(1) },
    { key: "treble", label: "Treble", min: 0, max: 10, default: 5, format: (v) => v.toFixed(1) },
    { key: "output", label: "Output", min: -24, max: 24, default: 0, format: dbSigned },
    { key: "normalize", label: "Normalize", min: 0, max: 1, default: 1, format: (v) => (v >= 0.5 ? "On" : "Off") },
    { key: "size", label: "Size", min: 0, max: 1, default: 1, format: (v) => (v >= 0.5 ? "Full" : "Lite") },
  ],
  // The Furnace amp (see ampModel.ts): 0-10 knobs, three channel modes
  // and the rectifier switch.
  tubeAmp: [
    { key: "gain", label: "Gain", min: 0, max: 10, default: AMP_DEFAULTS.gain, format: tenths },
    { key: "bass", label: "Bass", min: 0, max: 10, default: AMP_DEFAULTS.bass, format: tenths },
    { key: "mid", label: "Middle", min: 0, max: 10, default: AMP_DEFAULTS.mid, format: tenths },
    { key: "treble", label: "Treble", min: 0, max: 10, default: AMP_DEFAULTS.treble, format: tenths },
    { key: "presence", label: "Presence", min: 0, max: 10, default: AMP_DEFAULTS.presence, format: tenths },
    { key: "master", label: "Master", min: 0, max: 10, default: AMP_DEFAULTS.master, format: tenths },
    { key: "output", label: "Output", min: -24, max: 24, default: 0, format: dbSigned },
    { key: "mode", label: "Mode", min: 0, max: AMP_MODES.length - 1, default: AMP_MODES.length - 1, format: (v) => AMP_MODE_LABELS[ampMode(v)], automatable: false },
    { key: "rectifier", label: "Rectifier", min: 0, max: 1, default: 1, format: (v) => AMP_RECTIFIER_LABELS[ampRectifier(v)], automatable: false },
  ],
  // Range at -80 dB means fully closed (silence).
  gate: [
    { key: "threshold", label: "Threshold", min: -100, max: 0, default: -60, format: dbSpaced },
    { key: "attack", label: "Attack", min: 0.0001, max: 0.05, default: 0.001, format: (v) => (v < 0.001 ? `${(v * 1000).toFixed(2)} ms` : msSpaced(v)) },
    { key: "hold", label: "Hold", min: 0, max: 0.5, default: 0.05, format: msSpaced },
    { key: "release", label: "Release", min: 0.005, max: 2, default: 0.15, format: msSpaced },
    { key: "range", label: "Range", min: -80, max: 0, default: -80, format: (v) => (v <= -79.95 ? "-∞ dB" : dbSpaced(v)) },
    ...SIDECHAIN_SPECS,
  ],
  paramEq: paramEqSpecs(),
  multiband: multibandSpecs(),
  // Gain at -60 dB is silence; width 0..4 is 0..400%.
  utility: [
    { key: "gain", label: "Gain", min: UTILITY_GAIN_FLOOR, max: 35, default: 0, format: (v) => (v <= UTILITY_GAIN_FLOOR + 0.05 ? "-∞ dB" : dbSigned(v)) },
    { key: "width", label: "Width", min: 0, max: 4, default: 1, format: (v) => `${Math.round(v * 100)}%` },
    { key: "balance", label: "Balance", min: -1, max: 1, default: 0, format: (v) => (Math.abs(v) < 0.005 ? "C" : `${Math.round(Math.abs(v) * 50)}${v < 0 ? "L" : "R"}`) },
    { key: "bassFreq", label: "Bass Mono Freq", min: 50, max: 500, default: 120, format: hzSpaced },
    { key: "mono", label: "Mono", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off"), automatable: false },
    { key: "bassMono", label: "Bass Mono", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off"), automatable: false },
    { key: "invertL", label: "Invert Left", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off"), automatable: false },
    { key: "invertR", label: "Invert Right", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off"), automatable: false },
    { key: "channel", label: "Channel", min: 0, max: UTILITY_CHANNEL_MODES.length - 1, default: 0, format: (v) => UTILITY_CHANNEL_LABELS[UTILITY_CHANNEL_MODES[Math.round(v)]] ?? "Stereo", automatable: false },
    { key: "dcFilter", label: "DC Filter", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off"), automatable: false },
    { key: "mute", label: "Mute", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "Muted" : "Off") },
  ],
  // Ratio, Attack and Release are steps (see glueModel.ts); Release's last
  // step is Auto.
  glue: [
    { key: "threshold", label: "Threshold", min: -40, max: 0, default: -10, format: dbSpaced },
    { key: "ratio", label: "Ratio", min: 0, max: GLUE_RATIOS.length - 1, default: 1, format: (v) => `${glueRatio(v)}:1` },
    { key: "attack", label: "Attack", min: 0, max: GLUE_ATTACKS_MS.length - 1, default: 5, format: formatGlueAttack },
    { key: "release", label: "Release", min: 0, max: GLUE_AUTO_RELEASE, default: GLUE_AUTO_RELEASE, format: formatGlueRelease },
    { key: "makeup", label: "Makeup", min: 0, max: 20, default: 0, format: dbSigned },
    { key: "range", label: "Range", min: -70, max: 0, default: -70, format: dbSpaced },
    { key: "dryWet", label: "Dry/Wet", min: 0, max: 1, default: 1, format: pct },
    { key: "softClip", label: "Soft Clip", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off"), automatable: false },
    { key: "oversample", label: "Oversampling", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "2x" : "Off"), automatable: false },
    ...SIDECHAIN_SPECS,
    { key: "scMix", label: "Sidechain Mix", min: 0, max: 1, default: 1, format: pct },
  ],
  mbDynamics: mbDynamicsSpecs(),
  tuner: [
    { key: "reference", label: "Reference", min: 410, max: 480, default: 440, format: (v) => `A4 = ${v.toFixed(1)} Hz`, automatable: false },
    { key: "mute", label: "Mute", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "Muted" : "Off"), automatable: false },
    { key: "flats", label: "Note Names", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "Flats" : "Sharps"), automatable: false },
  ],
};

/** The Parametric EQ's params: MAX_EQ_BANDS bands, each stored as flat
 * `b<n>On/Shape/Freq/Gain/Q/Slope/Place` keys (On: 0 no band, 1 active, 2
 * bypassed), plus output gain and two view settings. */
function paramEqSpecs(): ParamSpec[] {
  const hzFine = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${v.toFixed(v < 100 ? 1 : 0)} Hz`);
  const specs: ParamSpec[] = [];
  for (let i = 0; i < MAX_EQ_BANDS; i++) {
    const n = i + 1;
    specs.push(
      { key: `b${n}On`, label: `Band ${n} On`, min: 0, max: 2, default: 0, format: (v) => ["Off", "On", "Bypassed"][Math.round(v)] ?? "Off", automatable: false },
      { key: `b${n}Shape`, label: `Band ${n} Shape`, min: 0, max: EQ_SHAPES.length - 1, default: 0, format: (v) => EQ_SHAPE_LABELS[EQ_SHAPES[Math.round(v)]] ?? "Bell", automatable: false },
      { key: `b${n}Freq`, label: `Band ${n} Freq`, min: 10, max: 22000, default: defaultBandFreq(i), format: hzFine },
      { key: `b${n}Gain`, label: `Band ${n} Gain`, min: -30, max: 30, default: 0, format: dbSigned },
      { key: `b${n}Q`, label: `Band ${n} Q`, min: 0.025, max: 40, default: 1, format: (v) => v.toFixed(v < 10 ? 2 : 1) },
      { key: `b${n}Slope`, label: `Band ${n} Slope`, min: 6, max: 96, default: 12, format: (v) => `${Math.round(v)} dB/oct`, automatable: false },
      { key: `b${n}Place`, label: `Band ${n} Placement`, min: 0, max: EQ_PLACEMENTS.length - 1, default: 0, format: (v) => EQ_PLACEMENT_LABELS[EQ_PLACEMENTS[Math.round(v)]] ?? "Stereo", automatable: false }
    );
  }
  specs.push(
    { key: "output", label: "Output", min: -24, max: 24, default: 0, format: dbSigned },
    { key: "scale", label: "Display Range", min: 3, max: 30, default: 12, format: (v) => `±${Math.round(v)} dB`, automatable: false },
    { key: "analyzer", label: "Analyzer", min: 0, max: 2, default: 2, format: (v) => ["Off", "Post", "Pre + Post"][Math.round(v)] ?? "Off", automatable: false }
  );
  return specs;
}

/** The Multiband Compressor's params: the band count, up to
 * MB_MAX_BANDS - 1 crossovers (`x<n>`), each band's dynamics as flat
 * `b<n>Thresh/Ratio/...` keys, mix/output, and two view settings. */
function multibandSpecs(): ParamSpec[] {
  const hzFine = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${Math.round(v)} Hz`);
  const time = (v: number) => (v < 0.01 ? `${(v * 1000).toFixed(1)} ms` : msSpaced(v));
  const specs: ParamSpec[] = [
    { key: "bands", label: "Bands", min: 1, max: MB_MAX_BANDS, default: MB_DEFAULT_BANDS, format: (v) => `${Math.round(v)}`, automatable: false },
  ];
  for (let k = 0; k < MB_MAX_BANDS - 1; k++) {
    specs.push({ key: `x${k + 1}`, label: `Crossover ${k + 1}`, min: 20, max: 20000, default: MB_DEFAULT_CROSSOVERS[k], format: hzFine });
  }
  for (let i = 0; i < MB_MAX_BANDS; i++) {
    const n = i + 1;
    const d = MB_BAND_DEFAULTS;
    specs.push(
      { key: `b${n}Thresh`, label: `Band ${n} Threshold`, min: -60, max: 0, default: d.Thresh, format: dbSpaced },
      { key: `b${n}Ratio`, label: `Band ${n} Ratio`, min: 1, max: 20, default: d.Ratio, format: (v) => `${v.toFixed(v < 10 ? 1 : 0)}:1` },
      { key: `b${n}Attack`, label: `Band ${n} Attack`, min: 0.0001, max: 0.5, default: d.Attack, format: time },
      { key: `b${n}Release`, label: `Band ${n} Release`, min: 0.005, max: 2, default: d.Release, format: time },
      { key: `b${n}Knee`, label: `Band ${n} Knee`, min: 0, max: 24, default: d.Knee, format: dbSpaced },
      { key: `b${n}Range`, label: `Band ${n} Range`, min: 0, max: 60, default: d.Range, format: dbSpaced },
      { key: `b${n}Gain`, label: `Band ${n} Gain`, min: -24, max: 24, default: d.Gain, format: dbSigned },
      { key: `b${n}Mode`, label: `Band ${n} Mode`, min: 0, max: MB_MODES.length - 1, default: d.Mode, format: (v) => MB_MODE_LABELS[MB_MODES[Math.round(v)]] ?? "Compress", automatable: false },
      { key: `b${n}Bypass`, label: `Band ${n} Bypass`, min: 0, max: 1, default: d.Bypass, format: (v) => (v >= 0.5 ? "Bypassed" : "On"), automatable: false }
    );
  }
  specs.push(
    { key: "mix", label: "Mix", min: 0, max: 1, default: 1, format: pct },
    { key: "output", label: "Output", min: -24, max: 24, default: 0, format: dbSigned },
    { key: "scale", label: "Display Range", min: 6, max: 48, default: 24, format: (v) => `±${Math.round(v)} dB`, automatable: false },
    { key: "analyzer", label: "Analyzer", min: 0, max: 2, default: 2, format: (v) => ["Off", "Post", "Pre + Post"][Math.round(v)] ?? "Off", automatable: false },
    ...SIDECHAIN_SPECS
  );
  return specs;
}

/** Multiband Dynamics: the Low/High band switches and crossovers, each
 * band's `<l|m|h><Field>` settings (see mbDynamicsModel.ts), and the
 * global controls. */
function mbDynamicsSpecs(): ParamSpec[] {
  const ms = (v: number) => (v < 0.01 ? `${(v * 1000).toFixed(1)} ms` : v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);
  const onOff = (v: number) => (v >= 0.5 ? "On" : "Off");
  const specs: ParamSpec[] = [
    { key: "lowOn", label: "Low Band", min: 0, max: 1, default: 1, format: onOff, automatable: false },
    { key: "highOn", label: "High Band", min: 0, max: 1, default: 1, format: onOff, automatable: false },
    { key: "xLow", label: "Low Crossover", min: 40, max: 2000, default: 120, format: hzSpaced },
    { key: "xHigh", label: "High Crossover", min: 300, max: 16000, default: 2500, format: hzSpaced },
  ];
  MBD_BANDS.forEach((b) => {
    const name = MBD_BAND_LABELS[b];
    const d = MBD_FIELD_DEFAULTS;
    specs.push(
      { key: mbdKey(b, "On"), label: `${name} On`, min: 0, max: 1, default: d.On, format: onOff, automatable: false },
      { key: mbdKey(b, "Solo"), label: `${name} Solo`, min: 0, max: 1, default: d.Solo, format: onOff, automatable: false },
      { key: mbdKey(b, "In"), label: `${name} Input`, min: -24, max: 24, default: d.In, format: dbSigned },
      { key: mbdKey(b, "Out"), label: `${name} Output`, min: -24, max: 24, default: d.Out, format: dbSigned },
      { key: mbdKey(b, "AboveT"), label: `${name} Above Threshold`, min: MBD_MIN_DB, max: 0, default: d.AboveT, format: dbSpaced },
      { key: mbdKey(b, "AboveR"), label: `${name} Above Ratio`, min: 0.5, max: 50, default: d.AboveR, format: formatMbdRatio },
      { key: mbdKey(b, "BelowT"), label: `${name} Below Threshold`, min: MBD_MIN_DB, max: 0, default: d.BelowT, format: dbSpaced },
      { key: mbdKey(b, "BelowR"), label: `${name} Below Ratio`, min: 0.1, max: 50, default: d.BelowR, format: formatMbdRatio },
      { key: mbdKey(b, "Attack"), label: `${name} Attack`, min: 0.0001, max: 1, default: d.Attack, format: ms },
      { key: mbdKey(b, "Release"), label: `${name} Release`, min: 0.001, max: 3, default: d.Release, format: ms }
    );
  });
  specs.push(
    { key: "softKnee", label: "Soft Knee", min: 0, max: 1, default: 1, format: onOff, automatable: false },
    { key: "rms", label: "Detection", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "RMS" : "Peak"), automatable: false },
    { key: "output", label: "Output", min: -24, max: 24, default: 0, format: dbSigned },
    { key: "time", label: "Time", min: 0.1, max: 10, default: 1, format: (v) => `${Math.round(v * 100)}%` },
    { key: "amount", label: "Amount", min: 0, max: 1, default: 1, format: pct },
    { key: "view", label: "View", min: 0, max: 2, default: 2, format: (v) => ["Time", "Below", "Above"][Math.round(v)] ?? "Above", automatable: false },
    ...SIDECHAIN_SPECS,
    { key: "scMix", label: "Sidechain Mix", min: 0, max: 1, default: 1, format: pct }
  );
  return specs;
}

/** The params an effect offers as automation targets: continuous ones, and
 * for the Parametric EQ and Multiband Compressor only the bands (and
 * crossovers) that exist. */
export function automatableParamSpecs(fx: EffectInstance): ParamSpec[] {
  const bandCount = fx.type === "multiband" ? mbBandCount(fx.params) : 0;
  return paramSpecs(fx.type).filter((spec) => {
    if (spec.automatable === false) return false;
    if (fx.type === "multiband") {
      const m = /^([bx])(\d+)/.exec(spec.key);
      if (!m) return true;
      return m[1] === "b" ? Number(m[2]) <= bandCount : Number(m[2]) < bandCount;
    }
    if (fx.type === "mbDynamics") {
      const b = /^([lh])[A-Z]/.exec(spec.key)?.[1];
      if (b === "l") return (fx.params.lowOn ?? 1) >= 0.5;
      if (b === "h") return (fx.params.highOn ?? 1) >= 0.5;
      return true;
    }
    const band = fx.type === "paramEq" ? /^b(\d+)/.exec(spec.key) : null;
    return !band || (fx.params[`b${band[1]}On`] ?? 0) >= 0.5;
  });
}

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
