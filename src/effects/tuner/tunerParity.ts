// The Tuner's parity fixture for its Rust port
// (crates/dawn-engine/src/effects/tuner.rs): the cases, rendered in
// Chromium by the studio's own nodes (tuner.ts). See
// src/test/webAudioParity.ts.

import { tunerAudio } from "./audio";
import { tunerEffect } from ".";
import { PARITY_BLOCK } from "../../test/kernelParity";
import { renderWebAudioParity, type WebAudioCase } from "../../test/webAudioParity";

export const TUNER_PARITY_CASES: WebAudioCase[] = [
  { name: "passes-through", params: {} },
  // Made muted, it fades out from the start.
  { name: "muted", params: { mute: 1 } },
  { name: "mute-turns-on", params: {}, change: { at: 40 * PARITY_BLOCK, params: { mute: 1 } } },
  { name: "mute-turns-off", params: { mute: 1 }, change: { at: 60 * PARITY_BLOCK, params: {} } },
  // The reference and note names are only the window's.
  { name: "reference-and-flats", params: { reference: 432, flats: 1 } },
];

export const renderTunerParity = () => renderWebAudioParity(tunerEffect, tunerAudio, TUNER_PARITY_CASES, "src/effects/tuner/tuner.ts", "tunerParity");
