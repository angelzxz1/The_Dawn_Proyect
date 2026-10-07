// How the Compressor's audio node is built and a parameter applied.

import { CompressorChain } from "./compressor";
import { defineAudio } from "../types";

export const compressorAudio = defineAudio<CompressorChain>({
  create(params) {
    return new CompressorChain(params);
  },
  set(node, key, value) {
    node.setParam(key, value);
  },
});
