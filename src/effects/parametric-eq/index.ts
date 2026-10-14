// The Parametric EQ: its key, name, browser group and parameters. Its
// audio node is in audio.ts, its rack card and window in ui.ts.

import { defineEffect, type ParamSpec } from "../types";
import { dbSigned } from "../format";
import { EQ_PLACEMENTS, EQ_PLACEMENT_LABELS, EQ_SHAPES, EQ_SHAPE_LABELS, MAX_EQ_BANDS, defaultBandFreq } from "./paramEqModel";

/** The Parametric EQ's params: MAX_EQ_BANDS bands, each stored as flat
 * `b<n>On/Shape/Freq/Gain/Q/Slope/Place` keys (On: 0 no band, 1 active, 2
 * bypassed), plus output gain and two view settings. */
function paramEqSpecs(): ParamSpec[] {
  const hzFine = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${v.toFixed(v < 100 ? 1 : 0)} Hz`);
  const specs: ParamSpec[] = [];
  for (let i = 0; i < MAX_EQ_BANDS; i++) {
    const n = i + 1;
    specs.push(
      { key: `b${n}On`, label: `Band ${n} On`, min: 0, max: 2, default: 0, format: (v) => ["Off", "On", "Bypassed"][Math.round(v)] ?? "Off", automatable: false },
      { key: `b${n}Shape`, label: `Band ${n} Shape`, min: 0, max: EQ_SHAPES.length - 1, default: 0, format: (v) => EQ_SHAPE_LABELS[EQ_SHAPES[Math.round(v)]] ?? "Bell", automatable: false },
      { key: `b${n}Freq`, label: `Band ${n} Freq`, min: 10, max: 22000, default: defaultBandFreq(i), format: hzFine },
      { key: `b${n}Gain`, label: `Band ${n} Gain`, min: -30, max: 30, default: 0, format: dbSigned },
      { key: `b${n}Q`, label: `Band ${n} Q`, min: 0.025, max: 40, default: 1, format: (v) => v.toFixed(v < 10 ? 2 : 1) },
      { key: `b${n}Slope`, label: `Band ${n} Slope`, min: 6, max: 96, default: 12, format: (v) => `${Math.round(v)} dB/oct`, automatable: false },
      { key: `b${n}Place`, label: `Band ${n} Placement`, min: 0, max: EQ_PLACEMENTS.length - 1, default: 0, format: (v) => EQ_PLACEMENT_LABELS[EQ_PLACEMENTS[Math.round(v)]] ?? "Stereo", automatable: false }
    );
  }
  specs.push(
    { key: "output", label: "Output", min: -24, max: 24, default: 0, format: dbSigned },
    { key: "scale", label: "Display Range", min: 3, max: 30, default: 12, format: (v) => `±${Math.round(v)} dB`, automatable: false },
    { key: "analyzer", label: "Analyzer", min: 0, max: 2, default: 2, format: (v) => ["Off", "Post", "Pre + Post"][Math.round(v)] ?? "Off", automatable: false }
  );
  return specs;
}

export const parametricEqEffect = defineEffect({
  type: "paramEq",
  label: "Parametric EQ",
  group: "EQ & Filter",
  params: paramEqSpecs(),
});
