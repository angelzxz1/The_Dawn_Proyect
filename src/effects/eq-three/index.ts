// The EQ Three: its key, name, browser group and parameters. Its
// audio node is in audio.ts, its rack card and window in ui.ts.

import { defineEffect } from "../types";
import { db, hz } from "../format";

export const eqThreeEffect = defineEffect({
  type: "eq3",
  label: "EQ Three",
  group: "EQ & Filter",
  params: [
    { key: "low", label: "Low", min: -24, max: 12, default: 0, format: db },
    { key: "mid", label: "Mid", min: -24, max: 12, default: 0, format: db },
    { key: "high", label: "High", min: -24, max: 12, default: 0, format: db },
    { key: "lowFrequency", label: "Low X", min: 60, max: 1000, default: 400, format: hz },
    { key: "highFrequency", label: "High X", min: 1000, max: 8000, default: 2500, format: hz },
  ],
});
