// The shapes every effect folder fills in. An effect describes itself in
// three files:
//   index.ts - what it is: its key, name, browser group and parameters
//              (no audio, no React, so the schema, the site and the tests
//              can read it);
//   audio.ts - how its audio node is built and a parameter applied;
//   ui.ts    - its rack card and window.
// registry.ts, nodes.ts and ui/registry.ts collect them.

import type * as Tone from "tone";

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

/** An uploaded file an effect uses. The file itself is stored alongside the
 * project's audio (see effectFiles.ts); the effect only keeps a reference. */
export interface EffectFileRef {
  id: string;
  /** The uploaded file's name, shown in the plugin. */
  name: string;
}

/** The effect browser's sections, in order. */
export const EFFECT_GROUP_NAMES = ["Dynamics", "EQ & Filter", "Modulation", "Distortion", "Reverb & Delay", "Amp & Cab", "Utilities"] as const;
export type EffectGroup = (typeof EFFECT_GROUP_NAMES)[number];

export interface EffectDefinition<T extends string = string> {
  /** The key saved in projects and presets - never change it. */
  type: T;
  label: string;
  group: EffectGroup;
  params: ParamSpec[];
  /** Its detector can listen to another track (a sidechain). */
  sidechain?: boolean;
  /** It takes an uploaded file (an impulse response, an amp model) as well
   * as its knobs. */
  file?: boolean;
}

export function defineEffect<T extends string>(definition: EffectDefinition<T>): EffectDefinition<T> {
  return definition;
}

/** Builds an effect's node from its params, and applies one param change. */
export interface EffectAudio {
  create(params: Record<string, number>): Tone.ToneAudioNode;
  set(node: Tone.ToneAudioNode, key: string, value: number): void;
}

/** An effect's audio, typed with its own node class. */
export function defineAudio<N extends Tone.ToneAudioNode>(audio: {
  create(params: Record<string, number>): N;
  set(node: N, key: string, value: number): void;
}): EffectAudio {
  return audio as unknown as EffectAudio;
}
