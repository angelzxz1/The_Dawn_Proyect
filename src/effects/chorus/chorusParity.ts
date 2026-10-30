// The Chorus's parity fixture for its Rust port
// (crates/dawn-engine/src/effects/chorus.rs): the cases, rendered in
// Chromium by the studio's own nodes (chorusChain.ts). See
// src/test/webAudioParity.ts.

import { chorusAudio } from "./audio";
import { chorusEffect } from ".";
import { PARITY_BLOCK } from "../../test/kernelParity";
import { renderWebAudioParity, type WebAudioCase } from "../../test/webAudioParity";

export const CHORUS_PARITY_CASES: WebAudioCase[] = [
  { name: "defaults", params: {} },
  { name: "triangle", params: { waveform: 1, frequency: 0.8, spread: 90, depth: 0.5 } },
  // The LFO's oscillator reads its table three ways, by how fast it runs:
  // linearly, through 3 points or through 5.
  { name: "fast-deep", params: { frequency: 8, delayTime: 12, depth: 1, wet: 1 } },
  { name: "mid-rate", params: { frequency: 2.5, delayTime: 6, spread: 45 } },
  { name: "slowest", params: { frequency: 0.05, delayTime: 20, depth: 0.3 } },
  // With feedback the delays are in a loop.
  { name: "feedback", params: { feedback: 0.6, delayTime: 8, depth: 0.4 } },
  { name: "feedback-short", params: { feedback: 0.9, delayTime: 2, depth: 0.5, waveform: 1 } },
  { name: "no-spread", params: { spread: 0, frequency: 3, wet: 0.8 } },
  { name: "dry", params: { wet: 0 } },
  { name: "rate-changes", params: {}, change: { at: 40 * PARITY_BLOCK, params: { frequency: 6 } } },
  { name: "feedback-turns-on", params: {}, change: { at: 50 * PARITY_BLOCK, params: { feedback: 0.5 } } },
  { name: "feedback-turns-off", params: { feedback: 0.7 }, change: { at: 50 * PARITY_BLOCK, params: { feedback: 0 } } },
  { name: "spread-changes", params: {}, change: { at: 30 * PARITY_BLOCK, params: { spread: 30 } } },
  { name: "waveform-changes", params: {}, change: { at: 60 * PARITY_BLOCK, params: { waveform: 1 } } },
  { name: "sweep-changes", params: {}, change: { at: 45 * PARITY_BLOCK, params: { delayTime: 15, depth: 0.2 } } },
];

export const renderChorusParity = () => renderWebAudioParity(chorusEffect, chorusAudio, CHORUS_PARITY_CASES, "src/effects/chorus/chorusChain.ts", "chorusParity");
