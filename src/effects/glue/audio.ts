// How the Glue Compressor's audio node is built and a parameter applied.

import { GlueChain } from "./glue";
import { defineAudio } from "../types";

export const glueAudio = defineAudio<GlueChain>({
  create(params) {
    return new GlueChain(params);
  },
  set(node, key, value) {
    node.setParam(key, value);
  },
});
