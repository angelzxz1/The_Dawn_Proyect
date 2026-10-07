// How the EQ Three's audio node is built and a parameter applied.

import * as Tone from "tone";
import { defineAudio } from "../types";

export const eqThreeAudio = defineAudio<Tone.EQ3>({
  create(params) {
    return new Tone.EQ3({
      low: params.low,
      mid: params.mid,
      high: params.high,
      lowFrequency: params.lowFrequency,
      highFrequency: params.highFrequency,
    });
  },
  set(node, key, value) {
    if (key === "low") node.low.value = value;
    else if (key === "mid") node.mid.value = value;
    else if (key === "high") node.high.value = value;
    else if (key === "lowFrequency") node.lowFrequency.value = value;
    else if (key === "highFrequency") node.highFrequency.value = value;
  },
});
