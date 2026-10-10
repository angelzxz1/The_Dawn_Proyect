// The instruments a MIDI track can play: none, the sampled piano, the
// Drum Rack or the synth. Shared by the live engine and the export.

import * as Tone from "tone";
import type { InstrumentType, SynthParams } from "../project/types";
import { PIANO_SAMPLE_BASE_URL, PIANO_SAMPLE_URLS } from "./piano/piano";
import { NullInstrument, type Instrument } from "./instrument";
import { DrumRack } from "./drum-rack/drumRack";
import { defaultDrumKit, type DrumKitParams } from "./drum-rack/drumParams";
import { SynthInstrument, defaultSynthParams } from "./synth/synth";
import { noteIssue } from "../services/issues";

export function createInstrument(
  type: InstrumentType | null,
  onSettled: () => void,
  synthParams?: SynthParams,
  drumParams?: DrumKitParams
): Instrument {
  if (type === null) {
    queueMicrotask(onSettled);
    return new NullInstrument();
  }
  if (type === "drums") {
    const rack = new DrumRack(drumParams ?? defaultDrumKit());
    void rack.ready.then(onSettled, onSettled);
    return rack;
  }
  if (type === "synth") {
    // Synth-built too - no samples to wait on.
    queueMicrotask(onSettled);
    return new SynthInstrument(synthParams ?? defaultSynthParams());
  }
  return new Tone.Sampler({
    urls: PIANO_SAMPLE_URLS,
    baseUrl: PIANO_SAMPLE_BASE_URL,
    release: 1,
    attack: 0,
    onload: onSettled,
    onerror: (error) => {
      onSettled();
      noteIssue("instrument.load", error);
    },
  });
}
