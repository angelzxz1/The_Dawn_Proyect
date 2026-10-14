// How the Chorus's audio node is built and a parameter applied.

import { ChorusChain } from "./chorusChain";
import { defineAudio } from "../types";

export const chorusAudio = defineAudio<ChorusChain>({
  create(params) {
    return new ChorusChain(params);
  },
  set(node, key, value) {
    if (key === "frequency") node.setRate(value);
    else if (key === "delayTime") node.setDelay(value);
    else if (key === "depth") node.setDepth(value);
    else if (key === "feedback") node.setFeedback(value);
    else if (key === "spread") node.setSpread(value);
    else if (key === "wet") node.setWet(value);
    else if (key === "waveform") node.setWaveform(value);
  },
});
