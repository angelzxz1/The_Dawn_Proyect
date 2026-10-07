// How the Multiband Compressor's audio node is built and a parameter applied.

import { MultibandChain } from "./multiband";
import { defineAudio } from "../types";

export const multibandAudio = defineAudio<MultibandChain>({
  create(params) {
    return new MultibandChain(params);
  },
  set(node, key, value) {
    node.setParam(key, value);
  },
});
