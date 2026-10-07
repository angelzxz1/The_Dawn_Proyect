// The NAM Amp: its key, name, browser group and parameters. Its
// audio node is in audio.ts, its rack card and window in ui.ts.

import { defineEffect } from "../types";
import { dbSigned } from "../format";

// Mirrors the official NAM plugin: Input/Output in dB, a Bass/Middle/
// Treble tone stack on 0-10 knobs (5 = flat), output normalized to the
// model's reported loudness, and A2 models' Full/Lite size.
export const namAmpEffect = defineEffect({
  type: "namAmp",
  label: "NAM Amp",
  group: "Amp & Cab",
  file: true,
  params: [
    { key: "input", label: "Input", min: -20, max: 20, default: 0, format: dbSigned },
    { key: "bass", label: "Bass", min: 0, max: 10, default: 5, format: (v) => v.toFixed(1) },
    { key: "middle", label: "Middle", min: 0, max: 10, default: 5, format: (v) => v.toFixed(1) },
    { key: "treble", label: "Treble", min: 0, max: 10, default: 5, format: (v) => v.toFixed(1) },
    { key: "output", label: "Output", min: -24, max: 24, default: 0, format: dbSigned },
    { key: "normalize", label: "Normalize", min: 0, max: 1, default: 1, format: (v) => (v >= 0.5 ? "On" : "Off") },
    { key: "size", label: "Size", min: 0, max: 1, default: 1, format: (v) => (v >= 0.5 ? "Full" : "Lite") },
  ],
});
