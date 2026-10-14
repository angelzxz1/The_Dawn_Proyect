// How the Parametric EQ's audio node is built and a parameter applied.

import { ParamEqChain } from "./paramEq";
import { defineAudio } from "../types";

export const parametricEqAudio = defineAudio<ParamEqChain>({
  create(params) {
    return new ParamEqChain(params);
  },
  set(node, key, value) {
    node.setParam(key, value);
  },
});
