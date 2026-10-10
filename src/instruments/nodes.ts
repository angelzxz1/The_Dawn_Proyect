// Builds the instrument a MIDI track plays (or a silent one for an empty
// track) and applies its settings, from each instrument folder's audio.ts.
// Shared by the live engine and the export.

import type { InstrumentType } from "./registry";
import type { InstrumentAudio, InstrumentSettings } from "./types";
import { NullInstrument, type Instrument } from "./instrument";
import { pianoAudio } from "./piano/audio";
import { drumRackAudio } from "./drum-rack/audio";
import { synthAudio } from "./synth/audio";

const AUDIO: Record<InstrumentType, InstrumentAudio> = {
  piano: pianoAudio,
  drums: drumRackAudio,
  synth: synthAudio,
};

export function createInstrument(type: InstrumentType | null, onSettled: () => void, settings: InstrumentSettings = {}): Instrument {
  if (type === null) {
    queueMicrotask(onSettled);
    return new NullInstrument();
  }
  return AUDIO[type].create(settings, onSettled);
}

/** Applies new settings to a track's instrument. Settings that belong to
 * another instrument are ignored (an edit arriving just after a switch). */
export function updateInstrument(type: InstrumentType | null, instrument: Instrument, settings: InstrumentSettings): void {
  if (type) AUDIO[type].update?.(instrument, settings);
}
