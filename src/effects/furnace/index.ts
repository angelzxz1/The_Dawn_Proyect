// The Furnace: its key, name, browser group and parameters. Its
// audio node is in audio.ts, its rack card and window in ui.ts.

import { defineEffect } from "../types";
import { dbSigned, tenths } from "../format";
import { AMP_DEFAULTS, AMP_MODES, AMP_MODE_LABELS, AMP_RECTIFIER_LABELS, ampMode, ampRectifier } from "./ampModel";

// The Furnace amp (see ampModel.ts): 0-10 knobs, three channel modes
// and the rectifier switch.
export const furnaceEffect = defineEffect({
  type: "tubeAmp",
  label: "Furnace",
  group: "Amp & Cab",
  params: [
    { key: "gain", label: "Gain", min: 0, max: 10, default: AMP_DEFAULTS.gain, format: tenths },
    { key: "bass", label: "Bass", min: 0, max: 10, default: AMP_DEFAULTS.bass, format: tenths },
    { key: "mid", label: "Middle", min: 0, max: 10, default: AMP_DEFAULTS.mid, format: tenths },
    { key: "treble", label: "Treble", min: 0, max: 10, default: AMP_DEFAULTS.treble, format: tenths },
    { key: "presence", label: "Presence", min: 0, max: 10, default: AMP_DEFAULTS.presence, format: tenths },
    { key: "master", label: "Master", min: 0, max: 10, default: AMP_DEFAULTS.master, format: tenths },
    { key: "output", label: "Output", min: -24, max: 24, default: 0, format: dbSigned },
    { key: "mode", label: "Mode", min: 0, max: AMP_MODES.length - 1, default: AMP_MODES.length - 1, format: (v) => AMP_MODE_LABELS[ampMode(v)], automatable: false },
    { key: "rectifier", label: "Rectifier", min: 0, max: 1, default: 1, format: (v) => AMP_RECTIFIER_LABELS[ampRectifier(v)], automatable: false },
  ],
});
