// The Compressor: its key, name, browser group and parameters. Its
// audio node is in audio.ts, its rack card and window in ui.ts.

import { defineEffect } from "../types";
import { db, pct, ms, ratio } from "../format";
import { SIDECHAIN_SPECS } from "../sidechain/specs";

export const compressorEffect = defineEffect({
  type: "compressor",
  label: "Compressor",
  group: "Dynamics",
  sidechain: true,
  params: [
    { key: "threshold", label: "Threshold", min: -60, max: 0, default: -24, format: db },
    { key: "ratio", label: "Ratio", min: 1, max: 20, default: 4, format: ratio },
    { key: "attack", label: "Attack", min: 0.001, max: 0.25, default: 0.02, format: ms },
    { key: "release", label: "Release", min: 0.01, max: 1, default: 0.2, format: ms },
    { key: "knee", label: "Knee", min: 0, max: 40, default: 6, format: db },
    { key: "makeup", label: "Makeup", min: -12, max: 24, default: 0, format: db },
    { key: "makeupAuto", label: "Auto Makeup", min: 0, max: 1, default: 1, format: (v) => (v >= 0.5 ? "Auto" : "Manual") },
    { key: "dryWet", label: "Dry/Wet", min: 0, max: 1, default: 1, format: pct },
    { key: "output", label: "Output", min: -24, max: 24, default: 0, format: db },
    ...SIDECHAIN_SPECS,
  ],
});
