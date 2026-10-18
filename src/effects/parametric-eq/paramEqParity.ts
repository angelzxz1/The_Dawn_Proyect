// The Parametric EQ's parity fixture for its Rust port
// (crates/dawn-engine/src/effects/param_eq.rs): the cases, rendered with the
// worklet's own kernel (paramEqModel.ts) the way the worklet runs it
// (paramEq.ts), as a generated Rust file and the rendered samples.
// paramEqParity.test.ts checks the stored fixture still matches; the Rust
// side's tests/param_eq_parity.rs compares the port against it. See
// src/test/kernelParity.ts.

import { EQ_SOURCE, eqBandsFromParams, type EqBand } from "./paramEqModel";
import { FixtureData, PARITY_BLOCK, PARITY_FRAMES, PARITY_SAMPLE_RATE, PARITY_STRIDE, fnv1a, paritySignal, rustF64, rustHex, type ParitySignal } from "../../test/kernelParity";

interface Kernel {
  set(state: { bands: EqBand[]; outputDb: number; solo: number }): void;
  process(inL: Float32Array | null, inR: Float32Array | null, outL: Float32Array, outR: Float32Array | null, n: number): void;
}

const ParamEq = new Function(`${EQ_SOURCE}; return ParamEqKernel;`)() as new (sr: number) => Kernel;

export interface ParamEqParityCase {
  name: string;
  params: Record<string, number>;
  input: "mono" | "stereo";
  /** New parameters (over the case's) from this frame on - a block start. */
  change?: { at: number; params: Record<string, number> };
}

/** Band `n`'s parameters (1-based), as the effect keeps them. */
function band(n: number, b: { on?: number; shape: number; freq: number; gain?: number; q?: number; slope?: number; place?: number }): Record<string, number> {
  return {
    [`b${n}On`]: b.on ?? 1,
    [`b${n}Shape`]: b.shape,
    [`b${n}Freq`]: b.freq,
    [`b${n}Gain`]: b.gain ?? 0,
    [`b${n}Q`]: b.q ?? 1,
    [`b${n}Slope`]: b.slope ?? 12,
    [`b${n}Place`]: b.place ?? 0,
  };
}

// Shapes: 0 bell, 1 low shelf, 2 low cut, 3 high shelf, 4 high cut, 5 notch,
// 6 band pass, 7 tilt shelf. Places: 0 stereo, 1 left, 2 right, 3 mid, 4 side.
export const PARAM_EQ_PARITY_CASES: ParamEqParityCase[] = [
  {
    name: "bells-and-shelves",
    params: {
      ...band(1, { shape: 0, freq: 200, gain: 6, q: 1.4 }),
      ...band(2, { shape: 1, freq: 80, gain: -4, q: 0.71 }),
      ...band(3, { shape: 3, freq: 8000, gain: 3, q: 1.2 }),
      ...band(4, { shape: 0, freq: 2500, gain: -8, q: 4 }),
      output: -2,
    },
    input: "stereo",
  },
  {
    name: "cuts",
    params: {
      ...band(1, { shape: 2, freq: 120, slope: 24, q: 0.71 }),
      ...band(2, { shape: 4, freq: 6000, slope: 18, q: 2 }),
      ...band(3, { shape: 2, freq: 40, slope: 96 }),
      ...band(4, { shape: 4, freq: 12000, slope: 6 }),
    },
    input: "stereo",
  },
  {
    name: "notch-band-pass-tilt",
    params: {
      ...band(1, { shape: 5, freq: 1000, q: 8 }),
      ...band(2, { shape: 6, freq: 3000, q: 2 }),
      ...band(3, { shape: 7, freq: 900, gain: 6 }),
    },
    input: "stereo",
  },
  {
    name: "placements",
    params: {
      ...band(1, { shape: 0, freq: 500, gain: 9, place: 1 }),
      ...band(2, { shape: 0, freq: 1500, gain: -9, place: 2 }),
      ...band(3, { shape: 0, freq: 300, gain: 6, place: 3 }),
      ...band(4, { shape: 4, freq: 2000, slope: 12, place: 4 }),
    },
    input: "stereo",
  },
  {
    name: "bypassed-band",
    params: { ...band(1, { on: 2, shape: 0, freq: 400, gain: 12 }), ...band(7, { shape: 0, freq: 700, gain: -3 }) },
    input: "stereo",
  },
  {
    name: "gliding",
    params: { ...band(1, { shape: 0, freq: 300, gain: 6 }), ...band(2, { shape: 2, freq: 100, slope: 24 }) },
    input: "stereo",
    change: { at: 60 * PARITY_BLOCK, params: { b1Freq: 1200, b1Gain: -6, b1Q: 3, b2Freq: 300, output: 4 } },
  },
  {
    name: "restarted",
    params: { ...band(1, { shape: 2, freq: 150, slope: 12 }), ...band(2, { shape: 0, freq: 2000, gain: 5 }) },
    input: "stereo",
    change: { at: 50 * PARITY_BLOCK, params: { b1Slope: 48, b2Shape: 3, b3On: 1, b3Shape: 6, b3Freq: 800 } },
  },
  {
    name: "mono-in",
    params: { ...band(1, { shape: 0, freq: 250, gain: 8, place: 3 }), ...band(2, { shape: 3, freq: 5000, gain: -5 }) },
    input: "mono",
  },
  {
    name: "extremes",
    params: {
      ...band(1, { shape: 0, freq: 22000, gain: 4, q: 0.01 }),
      ...band(2, { shape: 0, freq: 3, gain: -4, q: 40 }),
      ...band(3, { shape: 2, freq: 60, slope: 70, q: 5 }),
      ...band(24, { shape: 4, freq: 9000, slope: 40 }),
    },
    input: "stereo",
  },
];

const changeParams = (c: ParamEqParityCase) => (c.change ? { ...c.params, ...c.change.params } : null);
const state = (params: Record<string, number>) => ({ bands: eqBandsFromParams(params), outputDb: params.output ?? 0, solo: -1 });

function renderCase(c: ParamEqParityCase, sig: ParitySignal) {
  const k = new ParamEq(PARITY_SAMPLE_RATE);
  k.set(state(c.params));
  const changed = changeParams(c);
  const outL = new Float32Array(PARITY_FRAMES);
  const outR = new Float32Array(PARITY_FRAMES);
  for (let start = 0; start < PARITY_FRAMES; start += PARITY_BLOCK) {
    if (c.change && changed && start === c.change.at) k.set(state(changed));
    const n = Math.min(PARITY_BLOCK, PARITY_FRAMES - start);
    const part = (a: Float32Array) => a.subarray(start, start + n);
    k.process(part(sig.inL), c.input === "stereo" ? part(sig.inR) : null, part(outL), part(outR), n);
  }
  return { outL, outR };
}

const rustParams = (p: Record<string, number>) => `&[${Object.entries(p).map(([k, v]) => `("${k}", ${rustF64(v)})`).join(", ")}]`;

function rustCase(c: ParamEqParityCase): string {
  const changed = changeParams(c);
  return [
    "    Case {",
    `        name: "${c.name}",`,
    `        params: ${rustParams(c.params)},`,
    `        mono: ${c.input === "mono"},`,
    `        change: ${c.change && changed ? `Some((${c.change.at}, ${rustParams(changed)}))` : "None"},`,
    "    },",
  ].join("\n");
}

/** The fixture as it should be now: the Rust file's text, and the data
 * (per case: the kept left and right samples). */
export function renderParamEqParity(): { rust: string; data: FixtureData } {
  const sig = paritySignal();
  const data = new FixtureData();
  for (const c of PARAM_EQ_PARITY_CASES) {
    const { outL, outR } = renderCase(c, sig);
    for (const out of [outL, outR]) data.f32(out.filter((_, i) => i % PARITY_STRIDE === 0));
  }
  const rust = [
    "// @generated by src/effects/parametric-eq/paramEqParity.test.ts from the",
    "// JavaScript kernel (paramEqModel.ts). Don't edit it: to remake it,",
    "// run UPDATE_ENGINE_FIXTURES=1 npx vitest run --project unit paramEqParity",
    "",
    `const SAMPLE_RATE: f64 = ${rustF64(PARITY_SAMPLE_RATE)};`,
    `const FRAMES: usize = ${PARITY_FRAMES};`,
    `const BLOCK: usize = ${PARITY_BLOCK};`,
    `const STRIDE: usize = ${PARITY_STRIDE};`,
    `const SIGNAL_HASH: u32 = ${rustHex(fnv1a([sig.inL, sig.inR, sig.keyL, sig.keyR]))};`,
    "",
    "const CASES: &[Case] = &[",
    ...PARAM_EQ_PARITY_CASES.map(rustCase),
    "];",
    "",
  ].join("\n");
  return { rust, data };
}
