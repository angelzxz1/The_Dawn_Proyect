// How the Multiband Dynamics's audio node is built and a parameter applied.

import { MbDynamicsChain } from "./mbDynamics";
import { defineAudio } from "../types";

export const multibandDynamicsAudio = defineAudio<MbDynamicsChain>({
  create(params) {
    return new MbDynamicsChain(params);
  },
  set(node, key, value) {
    node.setParam(key, value);
  },
});
