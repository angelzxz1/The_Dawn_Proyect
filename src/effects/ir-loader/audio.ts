// How the IR Loader's audio node is built and a parameter applied.

import { IrLoaderChain } from "./irLoaderChain";
import { defineAudio } from "../types";

export const irLoaderAudio = defineAudio<IrLoaderChain>({
  create(params) {
    return new IrLoaderChain(params);
  },
  set(node, key, value) {
    if (key === "lowCut") node.setLowCut(value);
    else if (key === "highCut") node.setHighCut(value);
    else if (key === "output") node.setOutput(value);
    else if (key === "wet") node.setWet(value);
    else if (key === "normalize") node.setNormalize(value >= 0.5);
  },
});
