// The Delay's parity fixture for its Rust port
// (crates/dawn-engine/src/effects/delay.rs): the cases, rendered in
// Chromium by the studio's own nodes (delayChain.ts). See
// src/test/webAudioParity.ts.

import { delayAudio } from "./audio";
import { delayEffect } from ".";
import { PARITY_BLOCK } from "../../test/kernelParity";
import { renderWebAudioParity, type WebAudioCase } from "../../test/webAudioParity";

export const DELAY_PARITY_CASES: WebAudioCase[] = [
  { name: "defaults", params: {} },
  { name: "filter-off", params: { filterOn: 0 } },
  { name: "ping-pong", params: { pingPong: 1 } },
  { name: "ping-pong-unfiltered", params: { pingPong: 1, filterOn: 0, feedback: 0.7 } },
  // Times between samples.
  { name: "short-fractional", params: { delayTimeL: 0.0213, delayTimeR: 0.0337, feedback: 0.8, wet: 0.6 } },
  { name: "most-feedback", params: { feedback: 0.95, lowCut: 20, highCut: 18000, wet: 1 } },
  { name: "tight-filter", params: { lowCut: 800, highCut: 1500, feedback: 0.9 } },
  { name: "frozen", params: { freeze: 1 } },
  { name: "times-change", params: {}, change: { at: 40 * PARITY_BLOCK, params: { delayTimeL: 0.1, delayTimeR: 0.15 } } },
  { name: "freezes", params: {}, change: { at: 64 * PARITY_BLOCK, params: { freeze: 1 } } },
  { name: "thaws", params: { freeze: 1 }, change: { at: 30 * PARITY_BLOCK, params: {} } },
  { name: "filter-turns-off", params: {}, change: { at: 50 * PARITY_BLOCK, params: { filterOn: 0 } } },
  { name: "filter-turns-on", params: { filterOn: 0 }, change: { at: 50 * PARITY_BLOCK, params: {} } },
  { name: "ping-pong-turns-on", params: {}, change: { at: 70 * PARITY_BLOCK, params: { pingPong: 1 } } },
  { name: "feedback-and-wet-change", params: {}, change: { at: 30 * PARITY_BLOCK, params: { feedback: 0.2, wet: 0.8 } } },
];

export const renderDelayParity = () => renderWebAudioParity(delayEffect, delayAudio, DELAY_PARITY_CASES, "src/effects/delay/delayChain.ts", "delayParity");
