// How the Pitch Shift's audio node is built and a parameter applied.

import { PitchShifter } from "./pitchShifter";
import { defineAudio } from "../types";

export const pitchShiftAudio = defineAudio<PitchShifter>({
  create(params) {
    // Not Tone.PitchShift, which is out of tune - see pitchShifter.ts.
    return new PitchShifter({
      pitch: params.pitch,
      fine: params.fine,
      window: params.window,
      feedback: params.feedback,
      wet: params.wet,
    });
  },
  set(node, key, value) {
    if (key === "pitch") node.setPitch(value);
    else if (key === "fine") node.setFine(value);
    else if (key === "window") node.setWindow(value);
    else if (key === "feedback") node.setFeedback(value);
    else if (key === "wet") node.setWet(value);
  },
});
