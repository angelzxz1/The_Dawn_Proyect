// The Reverb's parity fixture for its Rust port
// (crates/dawn-engine/src/effects/reverb.rs): the cases, rendered in
// Chromium by the studio's own nodes (reverbChain.ts). See
// src/test/webAudioParity.ts.

import { reverbAudio } from "./audio";
import { reverbEffect } from ".";
import { PARITY_BLOCK } from "../../test/kernelParity";
import { renderWebAudioParity, type WebAudioCase } from "../../test/webAudioParity";

export const REVERB_PARITY_CASES: WebAudioCase[] = [
  { name: "defaults", params: {} },
  { name: "room", params: { mode: 1 } },
  { name: "plate", params: { mode: 2, decay: 2.5 } },
  { name: "long-narrow-hall", params: { decay: 4, width: 0.3 } },
  { name: "dark-no-early", params: { damping: 1000, early: 0 } },
  { name: "open-cuts", params: { lowCut: 20, highCut: 20000, damping: 20000 } },
  { name: "pre-delay", params: { preDelay: 0.08, wet: 0.6 } },
  { name: "all-wet", params: { wet: 1 } },
  { name: "mono", params: { width: 0, mode: 1 } },
  { name: "short-plate", params: { mode: 2, decay: 0.2, early: 1 } },
  { name: "wet-changes", params: {}, change: { at: 40 * PARITY_BLOCK, params: { wet: 0.7 } } },
  { name: "pre-delay-changes", params: { preDelay: 0.02 }, change: { at: 50 * PARITY_BLOCK, params: { preDelay: 0.15 } } },
  { name: "cuts-change", params: {}, change: { at: 30 * PARITY_BLOCK, params: { lowCut: 200, highCut: 9000 } } },
  // A new impulse takes the input; the old one rings out.
  { name: "decay-changes", params: { wet: 0.8 }, change: { at: 60 * PARITY_BLOCK, params: { wet: 0.8, decay: 0.5 } } },
  { name: "mode-changes", params: { mode: 2 }, change: { at: 45 * PARITY_BLOCK, params: { mode: 1 } } },
  { name: "width-changes", params: { wet: 1 }, change: { at: 70 * PARITY_BLOCK, params: { wet: 1, width: 0 } } },
];

export const renderReverbParity = () =>
  renderWebAudioParity(reverbEffect, reverbAudio, REVERB_PARITY_CASES, "src/effects/reverb/reverbChain.ts", "reverbParity");
