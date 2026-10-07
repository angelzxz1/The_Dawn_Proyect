// How the NAM Amp's audio node is built and a parameter applied.

import { NamAmpChain } from "./namAmp";
import { defineAudio } from "../types";

export const namAmpAudio = defineAudio<NamAmpChain>({
  create(params) {
    return new NamAmpChain(params);
  },
  set(node, key, value) {
    if (key === "input") node.setInput(value);
    else if (key === "bass" || key === "middle" || key === "treble") node.setTone(key, value);
    else if (key === "output") node.setOutput(value);
    else if (key === "normalize") node.setNormalize(value >= 0.5);
    else if (key === "size") node.setSize(value);
  },
});
