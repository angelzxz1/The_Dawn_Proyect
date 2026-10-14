// Every instrument a MIDI track can play, collected from the instrument
// folders (each one's index.ts says what it is: key, name and the settings
// it keeps on the track). Shared by the engine, the project schema and the
// UI. To add an instrument, give it a folder with index.ts, audio.ts and
// ui.tsx and list it here, in nodes.ts and in ui/registry.ts.

import type { InstrumentDefinition, InstrumentSettings, InstrumentSettingsKey } from "./types";
import { pianoInstrument } from "./piano";
import { drumRackInstrument } from "./drum-rack";
import { synthInstrument } from "./synth";

export type { InstrumentSettings };

/** In the instrument picker's order. */
const INSTRUMENTS = [pianoInstrument, drumRackInstrument, synthInstrument] as const;

/** The sound source a MIDI track plays through - "like in Ableton", an
 * instrument you pick per track rather than a single hardcoded piano. */
export type InstrumentType = (typeof INSTRUMENTS)[number]["type"];

const ALL: InstrumentDefinition<InstrumentType>[] = [...INSTRUMENTS];
const BY_TYPE = new Map(ALL.map((i) => [i.type, i]));

export const INSTRUMENT_TYPES: InstrumentType[] = ALL.map((i) => i.type);

export const INSTRUMENT_LABELS = Object.fromEntries(ALL.map((i) => [i.type, i.label])) as Record<InstrumentType, string>;

const SETTINGS_KEYS: InstrumentSettingsKey[] = ALL.flatMap((i) => (i.settings ? [i.settings.key] : []));

function settingsSpec(type: InstrumentType | null) {
  return type ? BY_TYPE.get(type)!.settings : undefined;
}

/** What an instrument starts from on a track that hasn't played it yet
 * (the synth's Init patch, the default kit); nothing if the track already
 * has its settings - switching away and back keeps what was dialed in - or
 * it keeps none. */
export function startingSettings(track: InstrumentSettings, type: InstrumentType | null): InstrumentSettings {
  const spec = settingsSpec(type);
  if (!spec || track[spec.key] !== undefined) return {};
  return { [spec.key]: spec.defaults() } as InstrumentSettings;
}

/** Reads back the settings a saved track kept for the instrument it plays
 * (those of instruments it switched away from aren't loaded). */
export function readInstrumentSettings(type: InstrumentType | null, saved: Record<string, unknown>): InstrumentSettings {
  const spec = settingsSpec(type);
  return spec ? ({ [spec.key]: spec.normalize(saved[spec.key]) } as InstrumentSettings) : {};
}

/** The instrument settings that changed between two versions of a track
 * (null if none did). */
export function changedInstrumentSettings(prev: InstrumentSettings, next: InstrumentSettings): InstrumentSettings | null {
  const keys = SETTINGS_KEYS.filter((key) => next[key] !== undefined && next[key] !== prev[key]);
  return keys.length > 0 ? (Object.fromEntries(keys.map((key) => [key, next[key]])) as InstrumentSettings) : null;
}
