// The Delay: its key, name, browser group and parameters. Its
// audio node is in audio.ts, its rack card and window in ui.ts.

import { defineEffect } from "../types";
import { pct, hz, sec } from "../format";

export const delayEffect = defineEffect({
  type: "delay",
  label: "Delay",
  group: "Reverb & Delay",
  params: [
    // Defaults match a dotted-eighth/eighth stereo delay at the project's
    // starting 120bpm (quarter note = 0.5s): 1/8 = 0.25s, 1/8 dotted = 0.375s.
    { key: "delayTimeL", label: "Time L", min: 0.02, max: 2, default: 0.25, format: sec },
    { key: "delayTimeR", label: "Time R", min: 0.02, max: 2, default: 0.375, format: sec },
    { key: "feedback", label: "Feedback", min: 0, max: 0.95, default: 0.45, format: pct },
    { key: "lowCut", label: "Low Cut", min: 20, max: 2000, default: 150, format: hz },
    { key: "highCut", label: "High Cut", min: 1000, max: 18000, default: 6000, format: hz },
    { key: "wet", label: "Dry/Wet", min: 0, max: 1, default: 0.3, format: pct },
    // The remaining keys are plain 0/1 toggles (matching how compressor's
    // makeupAuto works) - Sync and Link are UI-only (they change how the
    // Time L/R knobs are dragged and typed, not the audio graph itself);
    // Ping-Pong, Freeze, and Filter each have real DelayChain behavior.
    { key: "sync", label: "Sync", min: 0, max: 1, default: 1, format: (v) => (v >= 0.5 ? "Sync" : "Time") },
    { key: "link", label: "Link", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off") },
    { key: "pingPong", label: "Ping-Pong", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off") },
    { key: "freeze", label: "Freeze", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off") },
    { key: "filterOn", label: "Filter", min: 0, max: 1, default: 1, format: (v) => (v >= 0.5 ? "On" : "Off") },
  ],
});
