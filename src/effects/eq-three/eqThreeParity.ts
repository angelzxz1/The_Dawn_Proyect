// The EQ Three's parity fixture for its Rust port
// (crates/dawn-engine/src/effects/eq_three.rs): the cases, rendered in
// Chromium by the studio's own node (audio.ts). See
// src/test/webAudioParity.ts.

import { eqThreeAudio } from "./audio";
import { eqThreeEffect } from ".";
import { PARITY_BLOCK } from "../../test/kernelParity";
import { renderWebAudioParity, type WebAudioCase } from "../../test/webAudioParity";

export const EQ_THREE_PARITY_CASES: WebAudioCase[] = [
  { name: "defaults", params: {} },
  { name: "smile", params: { low: 6, mid: -12, high: 9 } },
  { name: "wide-crossovers", params: { low: -24, high: 12, lowFrequency: 120, highFrequency: 6000 } },
  { name: "crossovers-meet", params: { low: 3, mid: -6, high: -3, lowFrequency: 1000, highFrequency: 1000 } },
  { name: "knobs-move", params: { low: -6 }, change: { at: 50 * PARITY_BLOCK, params: { low: 4, mid: 2, high: -9, lowFrequency: 250, highFrequency: 4000 } } },
];

export const renderEqThreeParity = () => renderWebAudioParity(eqThreeEffect, eqThreeAudio, EQ_THREE_PARITY_CASES, "src/effects/eq-three/audio.ts", "eqThreeParity");
