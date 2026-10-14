// How the Furnace's audio node is built and a parameter applied.

import { AmpSimChain } from "./ampSim";
import { defineAudio } from "../types";

export const furnaceAudio = defineAudio<AmpSimChain>({
  create(params) {
    return new AmpSimChain(params);
  },
  set(node, key, value) {
    node.setParam(key, value);
  },
});
