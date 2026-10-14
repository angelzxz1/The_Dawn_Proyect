// How the synth is built from a track's patch, and a new patch applied.

import { defineInstrumentAudio } from "../types";
import { SynthInstrument } from "./synth";
import { initSynthParams } from "./synthParams";

export const synthAudio = defineInstrumentAudio<SynthInstrument>({
  create(settings, onSettled) {
    // Built in code - no samples to wait on.
    queueMicrotask(onSettled);
    return new SynthInstrument(settings.synthParams ?? initSynthParams());
  },
  update(synth, settings) {
    if (settings.synthParams) synth.setParams(settings.synthParams);
  },
});
