// How the Reverb's audio node is built and a parameter applied.

import { ReverbChain } from "./reverbChain";
import { defineAudio } from "../types";

export const reverbAudio = defineAudio<ReverbChain>({
  create(params) {
    return new ReverbChain(params);
  },
  set(node, key, value) {
    if (key === "preDelay") node.setPreDelay(value);
    else if (key === "decay") node.setDecay(value);
    else if (key === "damping") node.setDamping(value);
    else if (key === "early") node.setEarly(value);
    else if (key === "lowCut") node.setLowCut(value);
    else if (key === "highCut") node.setHighCut(value);
    else if (key === "width") node.setWidth(value);
    else if (key === "wet") node.setWet(value);
    else if (key === "mode") node.setMode(value);
  },
});
