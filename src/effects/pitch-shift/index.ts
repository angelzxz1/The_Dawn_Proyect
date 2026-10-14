// The Pitch Shift: its key, name, browser group and parameters. Its
// audio node is in audio.ts, its rack card and window in ui.ts.

import { defineEffect } from "../types";
import { pct, msSpaced } from "../format";

// pitch/wet keep their original keys so saved pitch shifters load.
export const pitchShiftEffect = defineEffect({
  type: "pitchShift",
  label: "Pitch Shift",
  group: "Modulation",
  params: [
    { key: "pitch", label: "Pitch", min: -24, max: 24, default: 0, format: (v) => `${Math.round(v) > 0 ? "+" : ""}${Math.round(v)} st` },
    { key: "fine", label: "Fine", min: -100, max: 100, default: 0, format: (v) => `${Math.round(v) > 0 ? "+" : ""}${Math.round(v)} ct` },
    { key: "window", label: "Window", min: 0.02, max: 0.25, default: 0.1, format: msSpaced },
    { key: "feedback", label: "Feedback", min: 0, max: 0.9, default: 0, format: pct },
    { key: "wet", label: "Dry/Wet", min: 0, max: 1, default: 1, format: pct },
  ],
});
