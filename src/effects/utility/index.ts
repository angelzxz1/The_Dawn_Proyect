// The Utility: its key, name, browser group and parameters. Its
// audio node is in audio.ts, its rack card and window in ui.ts.

import { defineEffect } from "../types";
import { dbSigned, hzSpaced } from "../format";
import { UTILITY_CHANNEL_LABELS, UTILITY_CHANNEL_MODES, UTILITY_GAIN_FLOOR } from "./utilityModel";

// Gain at -60 dB is silence; width 0..4 is 0..400%.
export const utilityEffect = defineEffect({
  type: "utility",
  label: "Utility",
  group: "Utilities",
  params: [
    { key: "gain", label: "Gain", min: UTILITY_GAIN_FLOOR, max: 35, default: 0, format: (v) => (v <= UTILITY_GAIN_FLOOR + 0.05 ? "-∞ dB" : dbSigned(v)) },
    { key: "width", label: "Width", min: 0, max: 4, default: 1, format: (v) => `${Math.round(v * 100)}%` },
    { key: "balance", label: "Balance", min: -1, max: 1, default: 0, format: (v) => (Math.abs(v) < 0.005 ? "C" : `${Math.round(Math.abs(v) * 50)}${v < 0 ? "L" : "R"}`) },
    { key: "bassFreq", label: "Bass Mono Freq", min: 50, max: 500, default: 120, format: hzSpaced },
    { key: "mono", label: "Mono", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off"), automatable: false },
    { key: "bassMono", label: "Bass Mono", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off"), automatable: false },
    { key: "invertL", label: "Invert Left", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off"), automatable: false },
    { key: "invertR", label: "Invert Right", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off"), automatable: false },
    { key: "channel", label: "Channel", min: 0, max: UTILITY_CHANNEL_MODES.length - 1, default: 0, format: (v) => UTILITY_CHANNEL_LABELS[UTILITY_CHANNEL_MODES[Math.round(v)]] ?? "Stereo", automatable: false },
    { key: "dcFilter", label: "DC Filter", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off"), automatable: false },
    { key: "mute", label: "Mute", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "Muted" : "Off") },
  ],
});
