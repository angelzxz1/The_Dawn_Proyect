// How the Saturator's audio node is built and a parameter applied.

import { SaturatorChain } from "./saturator";
import { defineAudio } from "../types";

export const saturatorAudio = defineAudio<SaturatorChain>({
  create(params) {
    return new SaturatorChain(params);
  },
  set(node, key, value) {
    node.setParam(key, value);
  },
});
