// The IR Loader: its key, name, browser group and parameters. Its
// audio node is in audio.ts, its rack card and window in ui.ts.

import { defineEffect } from "../types";
import { pct, dbSigned, hzSpaced } from "../format";

// Low/High Cut at their extremes (20 Hz / 20 kHz) are effectively off.
export const irLoaderEffect = defineEffect({
  type: "irLoader",
  label: "IR Loader",
  group: "Amp & Cab",
  file: true,
  params: [
    { key: "lowCut", label: "Low Cut", min: 20, max: 500, default: 20, format: (v) => (v <= 20.5 ? "Off" : hzSpaced(v)) },
    { key: "highCut", label: "High Cut", min: 1000, max: 20000, default: 20000, format: (v) => (v >= 19999 ? "Off" : hzSpaced(v)) },
    { key: "output", label: "Output", min: -24, max: 24, default: 0, format: dbSigned },
    { key: "wet", label: "Dry/Wet", min: 0, max: 1, default: 1, format: pct },
    { key: "normalize", label: "Normalize", min: 0, max: 1, default: 1, format: (v) => (v >= 0.5 ? "On" : "Off") },
  ],
});
