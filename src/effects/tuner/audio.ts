// How the Tuner's audio node is built and a parameter applied.

import { TunerChain } from "./tuner";
import { defineAudio } from "../types";

export const tunerAudio = defineAudio<TunerChain>({
  create(params) {
    return new TunerChain(params);
  },
  set(node, key, value) {
    if (key === "mute") node.setMute(value >= 0.5);
  },
});
