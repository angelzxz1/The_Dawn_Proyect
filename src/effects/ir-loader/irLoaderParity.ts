// The IR Loader's parity fixture for its Rust port
// (crates/dawn-engine/src/effects/ir_loader.rs): the cases, rendered in
// Chromium by the studio's own nodes (irLoaderChain.ts), each with one of
// the test's impulse responses. See src/test/webAudioParity.ts.

import { irLoaderAudio } from "./audio";
import { irLoaderEffect } from ".";
import type { IrLoaderChain } from "./irLoaderChain";
import { PARITY_BLOCK } from "../../test/kernelParity";
import { renderWebAudioParity, type WebAudioCase, type WebAudioFiles } from "../../test/webAudioParity";

/** The test's impulse responses: decaying noise, from arithmetic that
 * rounds the same in Rust (tests/ir_loader_parity.rs makes them too). */
export const PARITY_IRS: Record<string, { channels: number; frames: number; decay: number; level: number; seed: number }> = {
  cab: { channels: 1, frames: 1800, decay: 0.995, level: 0.6, seed: 11 },
  short: { channels: 1, frames: 90, decay: 0.95, level: 1, seed: 12 },
  room: { channels: 2, frames: 30000, decay: 0.9998, level: 0.2, seed: 13 },
  "true-stereo": { channels: 4, frames: 6000, decay: 0.999, level: 0.3, seed: 14 },
  three: { channels: 3, frames: 700, decay: 0.99, level: 0.5, seed: 15 },
};

export function parityImpulse(name: string): Float32Array<ArrayBuffer>[] {
  const spec = PARITY_IRS[name];
  let seed = spec.seed;
  return Array.from({ length: spec.channels }, () => {
    const data = new Float32Array(spec.frames);
    let env = spec.level;
    for (let i = 0; i < spec.frames; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = env * ((seed / 4294967296) * 2 - 1);
      env *= spec.decay;
    }
    return data;
  });
}

const files: WebAudioFiles = {
  load(node, file, context) {
    const chain = node as IrLoaderChain;
    if (file === "none") {
      chain.setImpulse(null);
      return;
    }
    const channels = parityImpulse(file);
    const buffer = context.createBuffer(channels.length, channels[0].length, context.sampleRate);
    channels.forEach((data, i) => buffer.copyToChannel(data, i));
    chain.setImpulse(buffer);
  },
};

export const IR_LOADER_PARITY_CASES: WebAudioCase[] = [
  // With no IR the wet path passes straight on. Most cases turn the low
  // cut on: Off is a 5 Hz high pass, which makes the convolutions' last
  // bits into a slow drift (see tests/ir_loader_parity.rs); those at Off
  // are held more loosely.
  { name: "no-file", params: { lowCut: 120, highCut: 6000 } },
  { name: "cab", params: {}, file: "cab" },
  { name: "cab-not-normalized", params: { normalize: 0 }, file: "cab" },
  { name: "short", params: { lowCut: 60 }, file: "short" },
  { name: "room", params: { lowCut: 90, wet: 0.5 }, file: "room" },
  { name: "true-stereo", params: { lowCut: 70 }, file: "true-stereo" },
  { name: "three-channels", params: { lowCut: 50 }, file: "three" },
  { name: "cab-shaped", params: { lowCut: 200, highCut: 3000, output: -6, wet: 0.6 }, file: "cab" },
  { name: "room-loud", params: { output: 6, normalize: 0 }, file: "room" },
  // Taking the IR out: the old one rings out and the input passes straight
  // on. Not here, as Chromium renders them differently from one run to the
  // next: swapping an IR in (the cuts after a new ConvolverNode sometimes
  // start afresh, sometimes not), and taking a mono one out (it rings out
  // mono, its left tail on both sides, and the cuts sometimes start afresh
  // at that). The port carries the cuts on; its unit tests cover both.
  { name: "room-removed", params: { lowCut: 100 }, file: "room", change: { at: 50 * PARITY_BLOCK, params: { lowCut: 100 }, file: "none" } },
  { name: "true-stereo-removed", params: {}, file: "true-stereo", change: { at: 70 * PARITY_BLOCK, params: {}, file: "none" } },
  { name: "cuts-and-wet-change", params: {}, file: "cab", change: { at: 35 * PARITY_BLOCK, params: { lowCut: 300, highCut: 2500, wet: 0.4, output: 3 } } },
];

export const renderIrLoaderParity = () =>
  renderWebAudioParity(irLoaderEffect, irLoaderAudio, IR_LOADER_PARITY_CASES, "src/effects/ir-loader/irLoaderChain.ts", "irLoaderParity", files);
