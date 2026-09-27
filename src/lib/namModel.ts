// NAM (Neural Amp Modeler) helpers that don't need audio: reading a .nam
// file's metadata, and the official NAM plugin's tone stack and output
// normalization, so the NAM Amp effect behaves like the plugin people know.

import type { FilterStage } from "./filterModel";

/** The plugin normalizes a model's output to this loudness. */
export const NAM_TARGET_LOUDNESS_DB = -18;

/** Largest .nam file accepted (real models are ~0.1-5 MB). */
export const MAX_NAM_BYTES = 50 * 1024 * 1024;

/** What the NAM Amp shows about a model, read from its file. */
export interface NamFileInfo {
  /** The model's own name, or the gear it captures, if the file says. */
  title: string | null;
  /** e.g. "Amp · Crunch" - gear type and tone type, when present. */
  subtitle: string | null;
  modeledBy: string | null;
  /** "A2", "WaveNet", "LSTM", ... */
  architecture: string;
  isA2: boolean;
  /** Hz, when the file says (most models are 48 kHz). */
  sampleRate: number | null;
  /** dB, when the file reports it (used to normalize output). */
  loudness: number | null;
}

type Json = Record<string, unknown>;

const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function titleCase(v: string): string {
  return v
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Checks that `json` looks like a NAM model and reads what the UI shows.
 * The engine does the real validation when it loads the model. */
export function parseNamFile(json: string): { info: NamFileInfo } | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { error: "isn't a NAM model (it isn't valid JSON)." };
  }
  const root = obj(data);
  const architecture = text(root.architecture);
  if (!architecture || !("config" in root)) return { error: "isn't a NAM model (no model architecture in it)." };

  const meta = obj(root.metadata);
  const gear = [text(meta.gear_make), text(meta.gear_model)].filter(Boolean).join(" ");
  const kind = [text(meta.gear_type), text(meta.tone_type)].filter((v): v is string => !!v).map(titleCase);
  const isA2 = architecture === "SlimmableContainer";
  return {
    info: {
      title: text(meta.name) ?? (gear || null),
      subtitle: kind.length ? kind.join(" · ") : null,
      modeledBy: text(meta.modeled_by),
      architecture: isA2 ? "A2" : architecture,
      isA2,
      sampleRate: finite(root.sample_rate),
      loudness: finite(meta.loudness),
    },
  };
}

/** Output gain (dB) that brings a model to the plugin's -18 dB loudness, or
 * 0 when normalizing is off or the model doesn't report its loudness. */
export function normalizationDb(normalize: boolean, loudness: number | null): number {
  return normalize && loudness !== null ? NAM_TARGET_LOUDNESS_DB - loudness : 0;
}

/** The plugin's tone stack: a 150 Hz low shelf (+/-20 dB), a 425 Hz peak
 * (+/-15 dB, wider when cutting), and a 1.8 kHz high shelf (+/-10 dB), on
 * 0-10 knobs where 5 is flat. */
export function toneStack(bass: number, middle: number, treble: number) {
  const middleDb = 3 * (middle - 5);
  return {
    bass: { frequency: 150, gainDb: 4 * (bass - 5) },
    middle: { frequency: 425, gainDb: middleDb, q: middleDb < 0 ? 1.5 : 0.7 },
    treble: { frequency: 1800, gainDb: 2 * (treble - 5) },
  };
}

/** Engine size value: the full model, or an A2 model's smaller Lite one. */
export function namSlimSize(sizeParam: number): number {
  return sizeParam >= 0.5 ? 1 : 0;
}

/** The tone stack as biquad stages, for drawing its curve with
 * filterModel's `filterResponseDb`. */
export function toneStackStages(bass: number, middle: number, treble: number): FilterStage[] {
  const stack = toneStack(bass, middle, treble);
  return [
    { type: "lowshelf", frequency: stack.bass.frequency, nativeQ: Math.SQRT1_2, gain: stack.bass.gainDb },
    { type: "peaking", frequency: stack.middle.frequency, nativeQ: stack.middle.q, gain: stack.middle.gainDb },
    { type: "highshelf", frequency: stack.treble.frequency, nativeQ: Math.SQRT1_2, gain: stack.treble.gainDb },
  ];
}
