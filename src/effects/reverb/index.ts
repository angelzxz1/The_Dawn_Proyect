// The Reverb: its key, name, browser group and parameters. Its
// audio node is in audio.ts, its rack card and window in ui.ts.

import { defineEffect } from "../types";
import { pct, msSpaced, secSpaced, hzSpaced } from "../format";

// `decay` and `wet` keep their original keys so reverbs saved before this
// plugin existed still load with their settings.
export const reverbEffect = defineEffect({
  type: "reverb",
  label: "Reverb",
  group: "Reverb & Delay",
  params: [
    { key: "preDelay", label: "Pre-Delay", min: 0, max: 0.25, default: 0, format: msSpaced },
    { key: "decay", label: "Decay", min: 0.2, max: 10, default: 1.2, format: secSpaced },
    { key: "damping", label: "Damping", min: 1000, max: 20000, default: 4700, format: hzSpaced },
    { key: "early", label: "Early", min: 0, max: 1, default: 0.8, format: pct },
    { key: "lowCut", label: "Low Cut", min: 20, max: 2000, default: 650, format: hzSpaced },
    { key: "highCut", label: "High Cut", min: 1000, max: 20000, default: 5000, format: hzSpaced },
    { key: "width", label: "Width", min: 0, max: 1, default: 1, format: pct },
    { key: "wet", label: "Dry/Wet", min: 0, max: 1, default: 0.25, format: pct },
    // 0 = Hall, 1 = Room, 2 = Plate (see reverbModel.ts).
    { key: "mode", label: "Mode", min: 0, max: 2, default: 0, format: (v) => ["Hall", "Room", "Plate"][Math.round(v)] ?? "Hall" },
  ],
});
