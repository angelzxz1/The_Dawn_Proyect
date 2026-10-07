// The Limiter: its key, name, browser group and parameters. Its
// audio node is in audio.ts, its rack card and window in ui.ts.

import { defineEffect } from "../types";
import { msSpaced, dbSpaced, dbSigned } from "../format";

// `threshold` keeps its original key (it's the Ceiling) so limiters saved
// before this plugin existed still load with their setting.
export const limiterEffect = defineEffect({
  type: "limiter",
  label: "Limiter",
  group: "Dynamics",
  params: [
    { key: "gain", label: "Gain", min: -12, max: 24, default: 0, format: dbSigned },
    { key: "threshold", label: "Ceiling", min: -30, max: 0, default: -0.3, format: dbSpaced },
    { key: "release", label: "Release", min: 0.001, max: 1, default: 0.05, format: msSpaced },
    { key: "softClip", label: "Soft Clip", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off") },
  ],
});
