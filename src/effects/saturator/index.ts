// The Saturator: its key, name, browser group and parameters. Its
// audio node is in audio.ts, its rack card and window in ui.ts.

import { defineEffect } from "../types";
import { pct, dbSigned, hzSpaced } from "../format";
import { COLOR_MODES, COLOR_MODE_LABELS, DISTORTION_SHAPES, SHAPE_LABELS, distortionShapeFromParam } from "./saturatorModel";

// The Saturator. `distortion` (Drive), `wet` and the first three shapes
// keep their original keys and meanings so saved distortions load and
// sound the same.
export const saturatorEffect = defineEffect({
  type: "distortion",
  label: "Saturator",
  group: "Distortion",
  params: [
    { key: "distortion", label: "Drive", min: 0, max: 1, default: 0.3, format: (v) => `+${(20 * Math.log10(1 + 30 * v)).toFixed(1)} dB` },
    { key: "bias", label: "Bias", min: 0, max: 1, default: 0, format: pct },
    { key: "tone", label: "Tone", min: 200, max: 20000, default: 8000, format: hzSpaced },
    { key: "output", label: "Output", min: -24, max: 12, default: 0, format: dbSigned },
    { key: "wet", label: "Dry/Wet", min: 0, max: 1, default: 1, format: pct },
    // See saturatorModel.ts for the curves; oversample 0..2 = off, 2x, 4x.
    { key: "shape", label: "Curve", min: 0, max: DISTORTION_SHAPES.length - 1, default: 0, format: (v) => SHAPE_LABELS[distortionShapeFromParam(v)], automatable: false },
    { key: "oversample", label: "Oversampling", min: 0, max: 2, default: 1, format: (v) => ["Off", "2x", "4x"][Math.round(v)] ?? "Off" },
    { key: "softClip", label: "Soft Clip", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off"), automatable: false },
    { key: "colorOn", label: "Color", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off"), automatable: false },
    { key: "colorMode", label: "Color Mode", min: 0, max: 2, default: 0, format: (v) => COLOR_MODE_LABELS[COLOR_MODES[Math.round(v)]] ?? "Pre", automatable: false },
    { key: "colorBase", label: "Color Base", min: -15, max: 15, default: 0, format: dbSigned },
    { key: "colorFreq", label: "Color Freq", min: 40, max: 16000, default: 1000, format: hzSpaced },
    { key: "colorQ", label: "Color Width", min: 0.3, max: 6, default: 0.7, format: (v) => `Q ${v.toFixed(2)}` },
    { key: "colorDepth", label: "Color Depth", min: -15, max: 15, default: 0, format: dbSigned },
  ],
});
