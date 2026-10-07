// The Filter: its key, name, browser group and parameters. Its
// audio node is in audio.ts, its rack card and window in ui.ts.

import { defineEffect } from "../types";
import { pct, dbSigned, hzSpaced } from "../format";

// `frequency` and `Q` keep their original keys. Older projects' single
// 0..1 "type" knob is migrated to `mode` on load (see filterModel.ts).
export const filterEffect = defineEffect({
  type: "filter",
  label: "Filter",
  group: "EQ & Filter",
  params: [
    { key: "frequency", label: "Cutoff", min: 20, max: 20000, default: 1200, format: hzSpaced },
    { key: "Q", label: "Reso", min: 0.1, max: 20, default: 1, format: (v) => `Q ${v.toFixed(2)}` },
    { key: "gain", label: "Gain", min: -24, max: 24, default: 0, format: dbSigned },
    { key: "lfoRate", label: "LFO Rate", min: 0.05, max: 20, default: 1, format: (v) => `${v.toFixed(2)} Hz` },
    { key: "lfoDepth", label: "LFO Depth", min: 0, max: 1, default: 0, format: pct },
    { key: "wet", label: "Dry/Wet", min: 0, max: 1, default: 1, format: pct },
    // 0..6 = LP, HP, BP, Notch, Peak, Low Shelf, High Shelf; slope 0..2 =
    // 12/24/48 dB per octave (see filterModel.ts).
    { key: "mode", label: "Type", min: 0, max: 6, default: 0, format: (v) => ["LP", "HP", "BP", "Notch", "Peak", "Low Shelf", "High Shelf"][Math.round(v)] ?? "LP" },
    { key: "slope", label: "Slope", min: 0, max: 2, default: 0, format: (v) => `${[12, 24, 48][Math.round(v)] ?? 12} dB/oct` },
  ],
});
