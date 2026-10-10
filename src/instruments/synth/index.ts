// The synth: its key, name, and the patch it keeps on the track (a new one
// starts from Init). Its sound source is built in audio.ts, its card and
// window are in ui.tsx.

import { defineInstrument } from "../types";
import { initSynthParams, normalizeSynthParams } from "./synthParams";

export const synthInstrument = defineInstrument({
  type: "synth",
  label: "Synth",
  settings: { key: "synthParams", defaults: initSynthParams, normalize: normalizeSynthParams },
});
