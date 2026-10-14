// How the Noise Gate's audio node is built and a parameter applied.

import { NoiseGate } from "./noiseGate";
import { defineAudio } from "../types";

export const gateAudio = defineAudio<NoiseGate>({
  create(params) {
    return new NoiseGate(params);
  },
  set(node, key, value) {
    node.setParam(key, value);
  },
});
