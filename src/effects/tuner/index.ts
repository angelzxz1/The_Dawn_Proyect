// The Tuner: its key, name, browser group and parameters. Its
// audio node is in audio.ts, its rack card and window in ui.ts.

import { defineEffect } from "../types";

export const tunerEffect = defineEffect({
  type: "tuner",
  label: "Tuner",
  group: "Utilities",
  params: [
    { key: "reference", label: "Reference", min: 410, max: 480, default: 440, format: (v) => `A4 = ${v.toFixed(1)} Hz`, automatable: false },
    { key: "mute", label: "Mute", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "Muted" : "Off"), automatable: false },
    { key: "flats", label: "Note Names", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "Flats" : "Sharps"), automatable: false },
  ],
});
