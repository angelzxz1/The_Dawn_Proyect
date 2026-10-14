// How the Filter's audio node is built and a parameter applied.

import { FilterChain } from "./filterChain";
import { defineAudio } from "../types";
import { legacyFilterTypeToMode } from "./filterModel";

export const filterAudio = defineAudio<FilterChain>({
  create(params) {
    return new FilterChain(params);
  },
  set(node, key, value) {
    if (key === "frequency") node.setFrequency(value);
    else if (key === "Q") node.setQ(value);
    else if (key === "gain") node.setGain(value);
    else if (key === "mode") node.setMode(value);
    else if (key === "slope") node.setSlope(value);
    else if (key === "lfoRate") node.setLfoRate(value);
    else if (key === "lfoDepth") node.setLfoDepth(value);
    else if (key === "wet") node.setWet(value);
    // Automation recorded on the pre-plugin 0..1 "type" knob.
    else if (key === "type") node.setMode(legacyFilterTypeToMode(value));
  },
});
