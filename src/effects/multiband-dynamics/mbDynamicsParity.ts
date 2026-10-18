// Multiband Dynamics' parity fixture for its Rust port
// (crates/dawn-engine/src/effects/mb_dynamics.rs): the cases, rendered with
// the worklet's own kernel (mbDynamicsModel.ts) the way the worklet runs it
// (mbDynamics.ts), as a generated Rust file and the rendered samples and
// meters. mbDynamicsParity.test.ts checks the stored fixture still matches;
// the Rust side's tests/mb_dynamics_parity.rs compares the port against it.
// See src/test/kernelParity.ts.

import { MBD_BANDS, MBD_SOURCE, mbdSettingsFromParams, type MbdBand, type MbdSettings } from "./mbDynamicsModel";
import { FixtureData, PARITY_BLOCK, PARITY_FRAMES, PARITY_SAMPLE_RATE, PARITY_STRIDE, fnv1a, paritySignal, rustF64, rustHex, type ParitySignal } from "../../test/kernelParity";

interface Kernel {
  set(s: MbdSettings): void;
  process(
    inL: Float32Array | null,
    inR: Float32Array | null,
    keyL: Float32Array | null,
    keyR: Float32Array | null,
    outL: Float32Array,
    outR: Float32Array | null,
    n: number
  ): void;
  takeMeters(): Partial<Record<MbdBand, { input: number; output: number }>>;
}

const MbDynamics = new Function(`${MBD_SOURCE}; return MbdKernel;`)() as new (sr: number) => Kernel;

/** How often (frames) the worklet reads the meters (mbDynamics.ts). */
export const MB_DYNAMICS_PARITY_METER_INTERVAL = 1024;

type Channels = "none" | "mono" | "stereo";

export interface MbDynamicsParityCase {
  name: string;
  params: Record<string, number>;
  external: boolean;
  input: Exclude<Channels, "none">;
  key: Channels;
  /** New parameters (over the case's) from this frame on - a block start. */
  change?: { at: number; params: Record<string, number> };
}

const base = { params: {}, external: false, input: "stereo", key: "none" } as const;

export const MB_DYNAMICS_PARITY_CASES: MbDynamicsParityCase[] = [
  { ...base, name: "defaults" },
  {
    ...base,
    name: "compress-and-expand",
    params: {
      lAboveT: -30,
      lAboveR: 4,
      lBelowT: -45,
      lBelowR: 2,
      mAboveT: -25,
      mAboveR: 0.7,
      mBelowT: -40,
      mBelowR: 0.5,
      hAboveT: -35,
      hAboveR: 3,
      hAttack: 0.002,
      hRelease: 0.2,
      amount: 0.8,
      time: 1.5,
      output: -2,
    },
  },
  {
    ...base,
    name: "rms-hard-knee-infinite-ratios",
    params: { rms: 1, softKnee: 0, mAboveT: -30, mAboveR: 50, lBelowT: -40, lBelowR: 50, hAboveT: -28, hAboveR: 2 },
  },
  { ...base, name: "one-band", params: { lowOn: 0, highOn: 0, mIn: 6, mOut: -3, mAboveT: -25, mAboveR: 3 } },
  { ...base, name: "close-crossovers", params: { xLow: 1000, xHigh: 1100, lAboveT: -30, lAboveR: 3 } },
  { ...base, name: "mid-solo", params: { mSolo: 1, mAboveT: -30, mAboveR: 4 } },
  { ...base, name: "band-off", params: { hOn: 0, hIn: 6, hAboveT: -40, hAboveR: 8, lAboveT: -30, lAboveR: 4 } },
  { ...base, name: "sidechain", params: { scMix: 0.6, mAboveT: -30, mAboveR: 4, lBelowT: -35, lBelowR: 3 }, external: true, key: "stereo" },
  { ...base, name: "sidechain-mono-key", params: { scHpf: 150, mAboveT: -30, mAboveR: 6 }, external: true, key: "mono" },
  { ...base, name: "key-filtered-own-input", params: { scHpf: 200, mAboveT: -35, mAboveR: 4 } },
  { ...base, name: "key-gain-only", params: { scGain: 6, mAboveT: -30, mAboveR: 4 } },
  { ...base, name: "listen", params: { scListen: 1, scLpf: 3000 } },
  { ...base, name: "low-switched-off", params: { lIn: 4, mAboveT: -30, mAboveR: 3 }, change: { at: 50 * PARITY_BLOCK, params: { lowOn: 0 } } },
  { ...base, name: "crossover-glide", params: { hAboveT: -35, hAboveR: 4 }, change: { at: 50 * PARITY_BLOCK, params: { xHigh: 6000, xLow: 300 } } },
  {
    ...base,
    name: "gains-change",
    params: { mAboveT: -30, mAboveR: 3 },
    change: { at: 60 * PARITY_BLOCK, params: { mIn: 6, mOut: -6, hOn: 0, output: 4, amount: 0.5 } },
  },
  { ...base, name: "mono-in", params: { lAboveT: -32, lAboveR: 4, hBelowT: -45, hBelowR: 2 }, input: "mono" },
];

const changeParams = (c: MbDynamicsParityCase) => (c.change ? { ...c.params, ...c.change.params } : null);

function renderCase(c: MbDynamicsParityCase, sig: ParitySignal) {
  const k = new MbDynamics(PARITY_SAMPLE_RATE);
  k.set(mbdSettingsFromParams(c.params, c.external));
  const changed = changeParams(c);
  const outL = new Float32Array(PARITY_FRAMES);
  const outR = new Float32Array(PARITY_FRAMES);
  const meters: number[][] = [];
  let count = 0;
  for (let start = 0; start < PARITY_FRAMES; start += PARITY_BLOCK) {
    if (c.change && changed && start === c.change.at) k.set(mbdSettingsFromParams(changed, c.external));
    const n = Math.min(PARITY_BLOCK, PARITY_FRAMES - start);
    const part = (a: Float32Array) => a.subarray(start, start + n);
    k.process(
      part(sig.inL),
      c.input === "stereo" ? part(sig.inR) : null,
      c.key === "none" ? null : part(sig.keyL),
      c.key === "stereo" ? part(sig.keyR) : null,
      part(outL),
      part(outR),
      n
    );
    count += n;
    if (count >= MB_DYNAMICS_PARITY_METER_INTERVAL) {
      count = 0;
      const m = k.takeMeters();
      // Per band, low to high: input and output, -1 for a band switched out.
      meters.push(MBD_BANDS.flatMap((b) => (m[b] ? [m[b].input, m[b].output] : [-1, -1])));
    }
  }
  return { outL, outR, meters };
}

const pascal = (c: Channels) => c[0].toUpperCase() + c.slice(1);
const rustParams = (p: Record<string, number>) => `&[${Object.entries(p).map(([k, v]) => `("${k}", ${rustF64(v)})`).join(", ")}]`;

function rustCase(c: MbDynamicsParityCase): string {
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
 * input and output of the low, mid and high band, -1 for one switched
 * out). */
export function renderMbDynamicsParity(): { rust: string; data: FixtureData } {
  const sig = paritySignal();
  const data = new FixtureData();
  for (const c of MB_DYNAMICS_PARITY_CASES) {
    const { outL, outR, meters } = renderCase(c, sig);
    for (const out of [outL, outR]) data.f32(out.filter((_, i) => i % PARITY_STRIDE === 0));
    data.f64(meters.flat());
  }
  const rust = [
    "// @generated by src/effects/multiband-dynamics/mbDynamicsParity.test.ts from",
    "// the JavaScript kernel (mbDynamicsModel.ts). Don't edit it: to remake it,",
    "// run UPDATE_ENGINE_FIXTURES=1 npx vitest run --project unit mbDynamicsParity",
    "",
    `const SAMPLE_RATE: f64 = ${rustF64(PARITY_SAMPLE_RATE)};`,
    `const FRAMES: usize = ${PARITY_FRAMES};`,
    `const BLOCK: usize = ${PARITY_BLOCK};`,
    `const STRIDE: usize = ${PARITY_STRIDE};`,
    `const METER_INTERVAL: usize = ${MB_DYNAMICS_PARITY_METER_INTERVAL};`,
    `const SIGNAL_HASH: u32 = ${rustHex(fnv1a([sig.inL, sig.inR, sig.keyL, sig.keyR]))};`,
    "",
    "const CASES: &[Case] = &[",
    ...MB_DYNAMICS_PARITY_CASES.map(rustCase),
    "];",
    "",
  ].join("\n");
  return { rust, data };
}
