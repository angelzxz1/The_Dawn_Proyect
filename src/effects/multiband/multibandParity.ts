// The Multiband Compressor's parity fixture for its Rust port
// (crates/dawn-engine/src/effects/multiband.rs): the cases, rendered with
// the worklet's own kernel (multibandModel.ts) the way the worklet runs it
// (multiband.ts), as a generated Rust file and the rendered samples and
// meters. multibandParity.test.ts checks the stored fixture still matches;
// the Rust side's tests/multiband_parity.rs compares the port against it.
// See src/test/kernelParity.ts.

import { MB_SOURCE, mbSettingsFromParams, type MbSettings } from "./multibandModel";
import { FixtureData, PARITY_BLOCK, PARITY_FRAMES, PARITY_SAMPLE_RATE, PARITY_STRIDE, fnv1a, paritySignal, rustF64, rustHex, type ParitySignal } from "../../test/kernelParity";

interface Kernel {
  meterGain: Float64Array;
  meterLevel: Float64Array;
  set(s: MbSettings): void;
  process(
    inL: Float32Array | null,
    inR: Float32Array | null,
    outL: Float32Array,
    outR: Float32Array | null,
    n: number,
    keyL: Float32Array | null,
    keyR: Float32Array | null
  ): void;
}

const Multiband = new Function(`${MB_SOURCE}; return MultibandKernel;`)() as new (sr: number) => Kernel;

/** How often (frames) the worklet reads the meters (multiband.ts). */
export const MULTIBAND_PARITY_METER_INTERVAL = 1024;

type Channels = "none" | "mono" | "stereo";

export interface MultibandParityCase {
  name: string;
  params: Record<string, number>;
  external: boolean;
  input: Exclude<Channels, "none">;
  key: Channels;
  /** New parameters (over the case's) from this frame on - a block start. */
  change?: { at: number; params: Record<string, number> };
}

const base = { params: {}, external: false, input: "stereo", key: "none" } as const;

export const MULTIBAND_PARITY_CASES: MultibandParityCase[] = [
  { ...base, name: "defaults" },
  {
    ...base,
    name: "three-bands-every-mode",
    params: {
      bands: 3,
      x1: 200,
      x2: 3000,
      b1Thresh: -30,
      b1Ratio: 6,
      b1Attack: 0.001,
      b1Gain: 3,
      b2Mode: 1,
      b2Thresh: -40,
      b2Ratio: 3,
      b3Mode: 2,
      b3Thresh: -30,
      b3Ratio: 3,
      b3Range: 12,
      b3Knee: 0,
      mix: 0.7,
      output: -2,
    },
  },
  {
    ...base,
    name: "six-bands-one-bypassed",
    params: { bands: 6, x1: 90, x2: 400, x3: 1500, x4: 5000, x5: 11000, b3Bypass: 1, b3Gain: 6, b5Thresh: -35, b5Knee: 12 },
  },
  { ...base, name: "one-band", params: { bands: 1, b1Thresh: -28, b1Ratio: 4 } },
  { ...base, name: "sidechain", params: { scHpf: 100, b1Thresh: -30, b2Thresh: -30 }, external: true, key: "stereo" },
  { ...base, name: "key-filtered-own-input", params: { scLpf: 2000, b4Thresh: -40 } },
  { ...base, name: "key-gain-only", params: { scGain: 6 } },
  { ...base, name: "listen", params: { scListen: 1, scHpf: 300 } },
  { ...base, name: "crossover-glide", params: { b1Thresh: -35 }, change: { at: 50 * PARITY_BLOCK, params: { x1: 400, x3: 3000 } } },
  { ...base, name: "band-count-change", params: { b2Gain: 4 }, change: { at: 50 * PARITY_BLOCK, params: { bands: 2, x1: 700 } } },
  { ...base, name: "bypass-and-mix-change", params: {}, change: { at: 60 * PARITY_BLOCK, params: { b2Bypass: 1, b2Gain: -6, mix: 0.5, output: 3 } } },
  { ...base, name: "mono-in", params: { b1Thresh: -32, b4Thresh: -32 }, input: "mono" },
];

const changeParams = (c: MultibandParityCase) => (c.change ? { ...c.params, ...c.change.params } : null);

function renderCase(c: MultibandParityCase, sig: ParitySignal) {
  const k = new Multiband(PARITY_SAMPLE_RATE);
  k.set(mbSettingsFromParams(c.params, -1, c.external));
  const changed = changeParams(c);
  const outL = new Float32Array(PARITY_FRAMES);
  const outR = new Float32Array(PARITY_FRAMES);
  const meters: number[][] = [];
  let count = 0;
  for (let start = 0; start < PARITY_FRAMES; start += PARITY_BLOCK) {
    if (c.change && changed && start === c.change.at) k.set(mbSettingsFromParams(changed, -1, c.external));
    const n = Math.min(PARITY_BLOCK, PARITY_FRAMES - start);
    const part = (a: Float32Array) => a.subarray(start, start + n);
    k.process(
      part(sig.inL),
      c.input === "stereo" ? part(sig.inR) : null,
      part(outL),
      part(outR),
      n,
      c.key === "none" ? null : part(sig.keyL),
      c.key === "stereo" ? part(sig.keyR) : null
    );
    count += n;
    if (count >= MULTIBAND_PARITY_METER_INTERVAL) {
      meters.push([...Array.from(k.meterGain), ...Array.from(k.meterLevel)]);
      k.meterGain.fill(0);
      k.meterLevel.fill(0);
      count = 0;
    }
  }
  return { outL, outR, meters };
}

const pascal = (c: Channels) => c[0].toUpperCase() + c.slice(1);
const rustParams = (p: Record<string, number>) => `&[${Object.entries(p).map(([k, v]) => `("${k}", ${rustF64(v)})`).join(", ")}]`;

function rustCase(c: MultibandParityCase): string {
  const changed = changeParams(c);
  return [
    "    Case {",
    `        name: "${c.name}",`,
    `        params: ${rustParams(c.params)},`,
    `        external: ${c.external},`,
    `        input: Channels::${pascal(c.input)},`,
    `        key: Channels::${pascal(c.key)},`,
    `        change: ${c.change && changed ? `Some((${c.change.at}, ${rustParams(changed)}))` : "None"},`,
    "    },",
  ].join("\n");
}

/** The fixture as it should be now: the Rust file's text, and the data
 * (per case: the kept left and right samples, then each meter reading's
 * six band gains and six band levels). */
export function renderMultibandParity(): { rust: string; data: FixtureData } {
  const sig = paritySignal();
  const data = new FixtureData();
  for (const c of MULTIBAND_PARITY_CASES) {
    const { outL, outR, meters } = renderCase(c, sig);
    for (const out of [outL, outR]) data.f32(out.filter((_, i) => i % PARITY_STRIDE === 0));
    data.f64(meters.flat());
  }
  const rust = [
    "// @generated by src/effects/multiband/multibandParity.test.ts from the",
    "// JavaScript kernel (multibandModel.ts). Don't edit it: to remake it,",
    "// run UPDATE_ENGINE_FIXTURES=1 npx vitest run --project unit multibandParity",
    "",
    `const SAMPLE_RATE: f64 = ${rustF64(PARITY_SAMPLE_RATE)};`,
    `const FRAMES: usize = ${PARITY_FRAMES};`,
    `const BLOCK: usize = ${PARITY_BLOCK};`,
    `const STRIDE: usize = ${PARITY_STRIDE};`,
    `const METER_INTERVAL: usize = ${MULTIBAND_PARITY_METER_INTERVAL};`,
    `const SIGNAL_HASH: u32 = ${rustHex(fnv1a([sig.inL, sig.inR, sig.keyL, sig.keyR]))};`,
    "",
    "const CASES: &[Case] = &[",
    ...MULTIBAND_PARITY_CASES.map(rustCase),
    "];",
    "",
  ].join("\n");
  return { rust, data };
}
