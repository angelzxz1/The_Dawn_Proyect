// The sampled piano: its key and name. It has nothing to set; its sampler
// is built in audio.ts, its picker icon is in ui.tsx.

import { defineInstrument } from "../types";

export const pianoInstrument = defineInstrument({ type: "piano", label: "Piano" });
