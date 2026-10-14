// The Glue Compressor: its key, name, browser group and parameters. Its
// audio node is in audio.ts, its rack card and window in ui.ts.

import { defineEffect } from "../types";
import { pct, dbSpaced, dbSigned } from "../format";
import { SIDECHAIN_SPECS } from "../sidechain/specs";
import { GLUE_ATTACKS_MS, GLUE_AUTO_RELEASE, GLUE_RATIOS, formatGlueAttack, formatGlueRelease, glueRatio } from "./glueModel";

// Ratio, Attack and Release are steps (see glueModel.ts); Release's last
// step is Auto.
export const glueEffect = defineEffect({
  type: "glue",
  label: "Glue Compressor",
  group: "Dynamics",
  sidechain: true,
  params: [
    { key: "threshold", label: "Threshold", min: -40, max: 0, default: -10, format: dbSpaced },
    { key: "ratio", label: "Ratio", min: 0, max: GLUE_RATIOS.length - 1, default: 1, format: (v) => `${glueRatio(v)}:1` },
    { key: "attack", label: "Attack", min: 0, max: GLUE_ATTACKS_MS.length - 1, default: 5, format: formatGlueAttack },
    { key: "release", label: "Release", min: 0, max: GLUE_AUTO_RELEASE, default: GLUE_AUTO_RELEASE, format: formatGlueRelease },
    { key: "makeup", label: "Makeup", min: 0, max: 20, default: 0, format: dbSigned },
    { key: "range", label: "Range", min: -70, max: 0, default: -70, format: dbSpaced },
    { key: "dryWet", label: "Dry/Wet", min: 0, max: 1, default: 1, format: pct },
    { key: "softClip", label: "Soft Clip", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off"), automatable: false },
    { key: "oversample", label: "Oversampling", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "2x" : "Off"), automatable: false },
    ...SIDECHAIN_SPECS,
    { key: "scMix", label: "Sidechain Mix", min: 0, max: 1, default: 1, format: pct },
  ],
});
