// The Chorus: its key, name, browser group and parameters. Its
// audio node is in audio.ts, its rack card and window in ui.ts.

import { defineEffect } from "../types";
import { pct } from "../format";

// frequency/delayTime/depth/wet keep their original keys (and meanings)
// so choruses saved before this plugin keep their sound.
export const chorusEffect = defineEffect({
  type: "chorus",
  label: "Chorus",
  group: "Modulation",
  params: [
    { key: "frequency", label: "Rate", min: 0.05, max: 10, default: 1.5, format: (v) => `${v.toFixed(2)} Hz` },
    { key: "delayTime", label: "Delay", min: 1, max: 20, default: 3.5, format: (v) => `${v.toFixed(1)} ms` },
    { key: "depth", label: "Depth", min: 0, max: 1, default: 0.7, format: pct },
    { key: "feedback", label: "Feedback", min: 0, max: 0.9, default: 0, format: pct },
    { key: "spread", label: "Spread", min: 0, max: 180, default: 180, format: (v) => `${Math.round(v)}°` },
    { key: "wet", label: "Dry/Wet", min: 0, max: 1, default: 0.5, format: pct },
    // 0 = sine, 1 = triangle.
    { key: "waveform", label: "Waveform", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "Triangle" : "Sine") },
  ],
});
