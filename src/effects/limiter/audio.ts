// How the Limiter's audio node is built and a parameter applied.

import { LookaheadLimiter } from "./lookaheadLimiter";
import { defineAudio } from "../types";

export const limiterAudio = defineAudio<LookaheadLimiter>({
  create(params) {
    // Not Tone.Limiter (a native compressor): see lookaheadLimiter.ts.
    return new LookaheadLimiter({
      ceilingDb: params.threshold,
      gainDb: params.gain,
      release: params.release,
      softClip: params.softClip >= 0.5,
    });
  },
  set(node, key, value) {
    if (key === "threshold") node.setCeiling(value);
    else if (key === "gain") node.setGain(value);
    else if (key === "release") node.setRelease(value);
    else if (key === "softClip") node.setSoftClip(value >= 0.5);
  },
});
