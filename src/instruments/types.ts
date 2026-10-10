// The shapes every instrument folder fills in, the way the effects do. An
// instrument describes itself in three files:
//   index.ts - what it is: its saved key, its name and the settings it
//              keeps on the track (no audio, no React, so the schema and
//              the tests can read it);
//   audio.ts - how its sound source is built and new settings applied;
//   ui.tsx   - its icon, and its rack card and window if it has them.
// registry.ts, nodes.ts and ui/registry.ts collect them.

import type { Instrument } from "./instrument";
import type { SynthParams } from "./synth/synthParams";
import type { DrumKitParams } from "./drum-rack/drumParams";

/** What a track keeps for its instruments, one field each, saved in
 * projects under these names (never rename them). A track keeps an
 * instrument's settings when it switches to another, so switching back
 * finds them as they were. */
export interface InstrumentSettings {
  /** The synth's patch - present once the track has played the synth. */
  synthParams?: SynthParams;
  /** The Drum Rack's kit - present once the track has played drums. */
  drumParams?: DrumKitParams;
}

export type InstrumentSettingsKey = keyof InstrumentSettings;

/** Where an instrument keeps its settings on the track, what they start
 * from, and how saved ones are read back. */
export type InstrumentSettingsSpec = {
  [K in InstrumentSettingsKey]: {
    key: K;
    defaults(): NonNullable<InstrumentSettings[K]>;
    normalize(saved: unknown): NonNullable<InstrumentSettings[K]>;
  };
}[InstrumentSettingsKey];

export interface InstrumentDefinition<T extends string = string> {
  /** The key saved in projects - never change it. */
  type: T;
  label: string;
  /** Left out for an instrument with nothing to set (the piano). */
  settings?: InstrumentSettingsSpec;
}

export function defineInstrument<T extends string>(definition: InstrumentDefinition<T>): InstrumentDefinition<T> {
  return definition;
}

/** Builds an instrument's sound source from the track's settings, and
 * applies new ones to it. */
export interface InstrumentAudio {
  /** `onSettled` is called once it can play (or its samples failed to
   * load). */
  create(settings: InstrumentSettings, onSettled: () => void): Instrument;
  update?(instrument: Instrument, settings: InstrumentSettings): void;
}

/** An instrument's audio, typed with its own class. */
export function defineInstrumentAudio<N extends Instrument>(audio: {
  create(settings: InstrumentSettings, onSettled: () => void): N;
  update?(instrument: N, settings: InstrumentSettings): void;
}): InstrumentAudio {
  return audio as unknown as InstrumentAudio;
}
