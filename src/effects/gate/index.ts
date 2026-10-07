// The Noise Gate: its key, name, browser group and parameters. Its
// audio node is in audio.ts, its rack card and window in ui.ts.

import { defineEffect } from "../types";
import { msSpaced, dbSpaced } from "../format";
import { SIDECHAIN_SPECS } from "../sidechain/specs";

// Range at -80 dB means fully closed (silence).
export const gateEffect = defineEffect({
  type: "gate",
  label: "Noise Gate",
  group: "Dynamics",
  sidechain: true,
  params: [
    { key: "threshold", label: "Threshold", min: -100, max: 0, default: -60, format: dbSpaced },
    { key: "attack", label: "Attack", min: 0.0001, max: 0.05, default: 0.001, format: (v) => (v < 0.001 ? `${(v * 1000).toFixed(2)} ms` : msSpaced(v)) },
    { key: "hold", label: "Hold", min: 0, max: 0.5, default: 0.05, format: msSpaced },
    { key: "release", label: "Release", min: 0.005, max: 2, default: 0.15, format: msSpaced },
    { key: "range", label: "Range", min: -80, max: 0, default: -80, format: (v) => (v <= -79.95 ? "-∞ dB" : dbSpaced(v)) },
    ...SIDECHAIN_SPECS,
  ],
});
