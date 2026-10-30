// The Saturator's parity fixture for its Rust port
// (crates/dawn-engine/src/effects/saturator.rs): the cases, rendered in
// Chromium by the studio's own nodes (saturator.ts). See
// src/test/webAudioParity.ts.

import { saturatorAudio } from "./audio";
import { saturatorEffect } from ".";
import { PARITY_BLOCK } from "../../test/kernelParity";
import { renderWebAudioParity, type WebAudioCase } from "../../test/webAudioParity";

export const SATURATOR_PARITY_CASES: WebAudioCase[] = [
  { name: "defaults", params: {} },
  { name: "digital-clip", params: { shape: 1, distortion: 0.6 } },
  { name: "sinoid-fold", params: { shape: 2, distortion: 0.5, bias: 0.2 } },
  { name: "soft-sine", params: { shape: 3, distortion: 0.8 } },
  { name: "medium-curve", params: { shape: 4, distortion: 1, bias: 0.6 } },
  { name: "hard-curve", params: { shape: 5, distortion: 0.4, bias: 0.3 } },
  { name: "oversampling-off", params: { oversample: 0, distortion: 0.7 } },
  { name: "off-biased-fold", params: { oversample: 0, shape: 2, distortion: 0.6, bias: 0.4 } },
  { name: "off-soft-clip", params: { oversample: 0, output: 12, softClip: 1, distortion: 0.9 } },
  { name: "off-emphasis-half-wet", params: { oversample: 0, colorOn: 1, colorMode: 2, colorBase: 6, colorDepth: 9, wet: 0.5 } },
  { name: "off-curve-changes", params: { oversample: 0 }, change: { at: 64 * PARITY_BLOCK, params: { oversample: 0, shape: 4, distortion: 1 } } },
  { name: "oversampling-4x", params: { oversample: 2, distortion: 0.7 } },
  { name: "4x-folded", params: { oversample: 2, shape: 2, distortion: 1 } },
  { name: "dark-tone", params: { tone: 400, output: -6 } },
  { name: "loud-soft-clip", params: { output: 12, softClip: 1, distortion: 0.9 } },
  // The dry path waits for the oversampling.
  { name: "half-wet", params: { wet: 0.5, distortion: 1 } },
  { name: "half-wet-4x", params: { wet: 0.5, oversample: 2, distortion: 1 } },
  { name: "color-pre", params: { colorOn: 1, colorBase: 9, colorFreq: 2500, colorQ: 2, colorDepth: 12 } },
  { name: "color-post", params: { colorOn: 1, colorMode: 1, colorBase: -12, colorFreq: 300, colorQ: 0.4, colorDepth: -8 } },
  { name: "color-emphasis", params: { colorOn: 1, colorMode: 2, colorBase: 6, colorFreq: 900, colorQ: 5, colorDepth: 15 } },
  { name: "drive-changes", params: {}, change: { at: 40 * PARITY_BLOCK, params: { distortion: 0.9, bias: 0.5 } } },
  { name: "curve-changes", params: { distortion: 0.6 }, change: { at: 64 * PARITY_BLOCK, params: { distortion: 0.6, shape: 5 } } },
  { name: "to-4x", params: { distortion: 0.8 }, change: { at: 50 * PARITY_BLOCK, params: { distortion: 0.8, oversample: 2 } } },
  { name: "4x-to-2x", params: { distortion: 0.8, oversample: 2 }, change: { at: 50 * PARITY_BLOCK, params: { distortion: 0.8 } } },
  // Off clears the filters; back on, they start afresh.
  { name: "off-and-on", params: { distortion: 0.8, oversample: 0 }, change: { at: 50 * PARITY_BLOCK, params: { distortion: 0.8 } } },
  { name: "soft-clip-turns-on", params: { output: 9 }, change: { at: 30 * PARITY_BLOCK, params: { output: 9, softClip: 1 } } },
  { name: "color-turns-on", params: {}, change: { at: 70 * PARITY_BLOCK, params: { colorOn: 1, colorBase: 8, colorDepth: -10 } } },
  { name: "tone-and-wet-change", params: {}, change: { at: 30 * PARITY_BLOCK, params: { tone: 1200, wet: 0.3 } } },
];

export const renderSaturatorParity = () =>
  renderWebAudioParity(saturatorEffect, saturatorAudio, SATURATOR_PARITY_CASES, "src/effects/saturator/saturator.ts", "saturatorParity");
