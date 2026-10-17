// The Limiter's parity fixture for its Rust port
// (crates/dawn-engine/src/effects/limiter.rs), which also guards the native
// engine's master: the cases, rendered by the worklet's own processor
// (lookaheadLimiter.ts) the way the browser runs it, as a generated Rust
// file and the rendered samples and meters. limiterParity.test.ts checks
// the stored fixture still matches; the Rust side's
// tests/limiter_parity.rs compares the port against it. See
// src/test/kernelParity.ts.

import { LIMITER_LOOKAHEAD, LIMITER_METER_INTERVAL, LIMITER_PROCESSOR_SOURCE } from "./lookaheadLimiter";
import { FixtureData, PARITY_BLOCK, PARITY_FRAMES, PARITY_SAMPLE_RATE, PARITY_STRIDE, fnv1a, paritySignal, rustF64, rustHex, type ParitySignal } from "../../test/kernelParity";

interface Meters {
  input: number;
  output: number;
  reduction: number;
}

interface Processor {
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

/** The processor class, run outside a worklet: its port collects what it
 * posts. */
function makeProcessor(posted: Meters[]): Processor {
  class WorkletStub {
    port = { postMessage: (m: Meters) => posted.push(m), onmessage: null as unknown };
  }
  const Processor = new Function("sampleRate", "AudioWorkletProcessor", "registerProcessor", `${LIMITER_PROCESSOR_SOURCE}; return DawnLookaheadLimiter;`)(
    PARITY_SAMPLE_RATE,
    WorkletStub,
    () => {}
  ) as new () => Processor;
  return new Processor();
}

interface Settings {
  ceilingDb: number;
  gainDb: number;
  release: number;
  softClip: boolean;
}

export interface LimiterParityCase {
  name: string;
  settings: Settings;
  input: "mono" | "stereo";
  /** New settings from this frame on - a block start. */
  change?: { at: number; settings: Settings };
}

const MASTER: Settings = { ceilingDb: -1, gainDb: 0, release: 0.1, softClip: false };

export const LIMITER_PARITY_CASES: LimiterParityCase[] = [
  { name: "master", settings: MASTER, input: "stereo" },
  { name: "driven", settings: { ...MASTER, gainDb: 12 }, input: "stereo" },
  { name: "soft-clip", settings: { ceilingDb: -3, gainDb: 9, release: 0.05, softClip: true }, input: "stereo" },
  { name: "mono-slow-release", settings: { ...MASTER, gainDb: 6, release: 0.8 }, input: "mono" },
  {
    name: "settings-change",
    settings: MASTER,
    input: "stereo",
    change: { at: 75 * PARITY_BLOCK, settings: { ceilingDb: -6, gainDb: 15, release: 0.02, softClip: false } },
  },
];

/** The processor's parameters for some settings: AudioParams, so float32. */
function parameters(s: Settings): { ceiling: number; gain: number; release: number; softClip: number } {
  return {
    ceiling: Math.fround(Math.pow(10, s.ceilingDb / 20)),
    gain: Math.fround(Math.pow(10, s.gainDb / 20)),
    release: Math.fround(s.release),
    softClip: s.softClip ? 1 : 0,
  };
}

function renderCase(c: LimiterParityCase, sig: ParitySignal): { outL: Float32Array; outR: Float32Array; meters: Meters[] } {
  const meters: Meters[] = [];
  const processor = makeProcessor(meters);
  const outL = new Float32Array(PARITY_FRAMES);
  const outR = new Float32Array(PARITY_FRAMES);
  let params = parameters(c.settings);
  for (let start = 0; start < PARITY_FRAMES; start += PARITY_BLOCK) {
    if (c.change && start === c.change.at) params = parameters(c.change.settings);
    const n = Math.min(PARITY_BLOCK, PARITY_FRAMES - start);
    const part = (a: Float32Array) => a.subarray(start, start + n);
    const input = c.input === "stereo" ? [part(sig.inL), part(sig.inR)] : [part(sig.inL)];
    processor.process([input], [[part(outL), part(outR)]], {
      ceiling: new Float32Array([params.ceiling]),
      gain: new Float32Array([params.gain]),
      release: new Float32Array([params.release]),
      softClip: new Float32Array([params.softClip]),
    });
  }
  return { outL, outR, meters };
}

function rustSettings(s: Settings): string {
  const p = parameters(s);
  return `LimiterSettings { ceiling: ${rustF64(p.ceiling)}, gain: ${rustF64(p.gain)}, release: ${rustF64(p.release)}, soft_clip: ${s.softClip} }`;
}

function rustCase(c: LimiterParityCase): string {
  const s = c.settings;
  return [
    "    Case {",
    `        name: "${c.name}",`,
    `        db: (${rustF64(s.ceilingDb)}, ${rustF64(s.gainDb)}),`,
    `        settings: ${rustSettings(s)},`,
    `        mono: ${c.input === "mono"},`,
    `        change: ${c.change ? `Some((${c.change.at}, ${rustSettings(c.change.settings)}))` : "None"},`,
    "    },",
  ].join("\n");
}

/** The fixture as it should be now: the Rust file's text, and the data
 * (per case: the kept left and right samples, then each meter reading's
 * input, output and reduction). */
export function renderLimiterParity(): { rust: string; data: FixtureData } {
  const sig = paritySignal();
  const data = new FixtureData();
  for (const c of LIMITER_PARITY_CASES) {
    const { outL, outR, meters } = renderCase(c, sig);
    for (const out of [outL, outR]) data.f32(out.filter((_, i) => i % PARITY_STRIDE === 0));
    data.f64(meters.flatMap((m) => [m.input, m.output, m.reduction]));
  }
  const rust = [
    "// @generated by src/effects/limiter/limiterParity.test.ts from the",
    "// JavaScript processor (lookaheadLimiter.ts). Don't edit it: to remake it,",
    "// run UPDATE_ENGINE_FIXTURES=1 npx vitest run --project unit limiterParity",
    "",
    `const SAMPLE_RATE: f64 = ${rustF64(PARITY_SAMPLE_RATE)};`,
    `const FRAMES: usize = ${PARITY_FRAMES};`,
    `const BLOCK: usize = ${PARITY_BLOCK};`,
    `const STRIDE: usize = ${PARITY_STRIDE};`,
    `const JS_LOOKAHEAD: f64 = ${rustF64(LIMITER_LOOKAHEAD)};`,
    `const JS_METER_INTERVAL: usize = ${LIMITER_METER_INTERVAL};`,
    `const SIGNAL_HASH: u32 = ${rustHex(fnv1a([sig.inL, sig.inR, sig.keyL, sig.keyR]))};`,
    "",
    "const CASES: &[Case] = &[",
    ...LIMITER_PARITY_CASES.map(rustCase),
    "];",
    "",
  ].join("\n");
  return { rust, data };
}
