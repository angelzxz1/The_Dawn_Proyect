// The Filter's parity fixture for its Rust port
// (crates/dawn-engine/src/effects/filter.rs): the cases, rendered in
// Chromium by the studio's own nodes (filterChain.ts). See
// src/test/webAudioParity.ts.

import { filterAudio } from "./audio";
import { filterEffect } from ".";
import { PARITY_BLOCK } from "../../test/kernelParity";
import { renderWebAudioParity, type WebAudioCase } from "../../test/webAudioParity";

export const FILTER_PARITY_CASES: WebAudioCase[] = [
  { name: "defaults", params: {} },
  { name: "lowpass-48-resonant", params: { frequency: 800, Q: 6, slope: 2 } },
  { name: "highpass-24-half-wet", params: { mode: 1, frequency: 3000, Q: 0.4, slope: 1, wet: 0.5 } },
  { name: "bandpass-48", params: { mode: 2, frequency: 1000, Q: 4, slope: 2 } },
  { name: "notch-24", params: { mode: 3, frequency: 2000, Q: 2, slope: 1 } },
  { name: "peak", params: { mode: 4, frequency: 1500, Q: 2, gain: 12 } },
  { name: "low-shelf", params: { mode: 5, frequency: 250, gain: -9, wet: 0.8 } },
  { name: "high-shelf", params: { mode: 6, frequency: 6000, gain: 6, Q: 7 } },
  { name: "lowpass-at-nyquist", params: { frequency: 20000, Q: 0.1 } },
  // The LFO sweeps every stage's cutoff, past Nyquist at the top.
  { name: "lfo-sweep", params: { frequency: 600, Q: 4, slope: 1, lfoRate: 3, lfoDepth: 0.5 } },
  { name: "lfo-past-nyquist", params: { mode: 1, frequency: 9000, lfoRate: 7.5, lfoDepth: 1, wet: 0.6 } },
  { name: "lfo-bandpass", params: { mode: 2, frequency: 1200, Q: 3, lfoRate: 0.5, lfoDepth: 0.8 } },
  // Changes: knob moves keep the stages; a new type or slope makes new ones.
  { name: "cutoff-moves", params: { frequency: 400, Q: 3 }, change: { at: 40 * PARITY_BLOCK, params: { frequency: 2500, Q: 5 } } },
  { name: "type-changes", params: { frequency: 900 }, change: { at: 60 * PARITY_BLOCK, params: { mode: 1, frequency: 900 } } },
  { name: "slope-changes", params: { mode: 2, frequency: 700 }, change: { at: 30 * PARITY_BLOCK, params: { mode: 2, frequency: 700, slope: 2 } } },
  { name: "lfo-starts", params: { frequency: 1500, lfoRate: 2 }, change: { at: 50 * PARITY_BLOCK, params: { frequency: 1500, lfoRate: 4, lfoDepth: 0.3, wet: 0.7 } } },
];

export const renderFilterParity = () => renderWebAudioParity(filterEffect, filterAudio, FILTER_PARITY_CASES, "src/effects/filter/filterChain.ts", "filterParity");
