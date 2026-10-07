// How the Delay's audio node is built and a parameter applied.

import { DelayChain } from "./delayChain";
import { defineAudio } from "../types";

export const delayAudio = defineAudio<DelayChain>({
  create(params) {
    return new DelayChain(params);
  },
  set(node, key, value) {
    if (key === "delayTimeL") node.setDelayTimeL(value);
    else if (key === "delayTimeR") node.setDelayTimeR(value);
    else if (key === "feedback") node.setFeedback(value);
    else if (key === "lowCut") node.setLowCut(value);
    else if (key === "highCut") node.setHighCut(value);
    else if (key === "wet") node.setWet(value);
    else if (key === "filterOn") node.setFilterOn(value >= 0.5);
    else if (key === "pingPong") node.setPingPong(value >= 0.5);
    else if (key === "freeze") node.setFreeze(value >= 0.5);
  },
});
