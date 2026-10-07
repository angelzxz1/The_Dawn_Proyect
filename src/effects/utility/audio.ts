// How the Utility's audio node is built and a parameter applied.

import { UtilityChain } from "./utility";
import { defineAudio } from "../types";

export const utilityAudio = defineAudio<UtilityChain>({
  create(params) {
    return new UtilityChain(params);
  },
  set(node, key, value) {
    node.setParam(key, value);
  },
});
