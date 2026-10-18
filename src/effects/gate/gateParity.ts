// The Noise Gate's parity fixture for its Rust port
// (crates/dawn-engine/src/effects/gate.rs): the cases, rendered with the
// worklet's own kernel (gateModel.ts) the way the worklet runs it
// (noiseGate.ts), as a generated Rust file and the rendered samples and
// meters. gateParity.test.ts checks the stored fixture still matches; the
// Rust side's tests/gate_parity.rs compares the port against it. See
// src/test/kernelParity.ts.

import { GATE_KERNEL_SOURCE, type GateKernelSettings } from "./gateModel";
import { gateSettingsFromParams } from "./noiseGate";
import { FixtureData, PARITY_BLOCK, PARITY_FRAMES, PARITY_SAMPLE_RATE, PARITY_STRIDE, fnv1a, paritySignal, rustF64, rustHex, type ParitySignal } from "../../test/kernelParity";

interface Kernel {
  open: boolean;
  set(s: GateKernelSettings): void;
  process(
    inL: Float32Array | null,
    inR: Float32Array | null,
    outL: Float32Array,
    outR: Float32Array | null,
    n: number,
    keyL: Float32Array | null,
    keyR: Float32Array | null
  ): { peakIn: number; minGain: number };
}

const Gate = new Function(`${GATE_KERNEL_SOURCE}; return NoiseGateKernel;`)() as new (sr: number) => Kernel;

/** How often (frames) the worklet reports its meters (noiseGate.ts). */
export const GATE_PARITY_METER_INTERVAL = 1024;

type Channels = "none" | "mono" | "stereo";

export interface GateParityCase {
  name: string;
  /** Over BASE_PARAMS. */
  params: Record<string, number>;
  external: boolean;
  input: Exclude<Channels, "none">;
  key: Channels;
  /** New parameters (over the case's) from this frame on - a block start. */
  change?: { at: number; params: Record<string, number> };
}

/** The Noise Gate's defaults when the fixture was made. */
const BASE_PARAMS: Record<string, number> = {
  threshold: -60,
  attack: 0.001,
  hold: 0.05,
  release: 0.15,
  range: -80,
  scGain: 0,
  scHpf: 20,
  scLpf: 20000,
  scListen: 0,
};

const base = { params: {}, external: false, input: "stereo", key: "none" } as const;

export const GATE_PARITY_CASES: GateParityCase[] = [
  { ...base, name: "defaults" },
  { ...base, name: "thresholded", params: { threshold: -24, hold: 0.02, release: 0.05 } },
  { ...base, name: "range-slow-attack-no-hold", params: { threshold: -30, attack: 0.02, hold: 0, range: -20 } },
  { ...base, name: "keyed-by-sidechain", params: { threshold: -12, release: 0.03 }, external: true, key: "stereo" },
  {
    ...base,
    name: "mono-key-filtered-mono-in",
    params: { threshold: -18, scHpf: 300, scLpf: 4000, scGain: 6 },
    external: true,
    input: "mono",
    key: "mono",
  },
  { ...base, name: "sidechain-unplugged", params: { threshold: -40 }, external: true },
  { ...base, name: "listen", params: { scListen: 1, scHpf: 500 } },
  { ...base, name: "settings-change", params: { threshold: -20 }, change: { at: 70 * PARITY_BLOCK, params: { threshold: -45, range: -12, hold: 0.2 } } },
];

const caseParams = (c: GateParityCase) => ({ ...BASE_PARAMS, ...c.params });
const changeParams = (c: GateParityCase) => (c.change ? { ...caseParams(c), ...c.change.params } : null);

function renderCase(c: GateParityCase, sig: ParitySignal) {
  const k = new Gate(PARITY_SAMPLE_RATE);
  k.set(gateSettingsFromParams(caseParams(c), c.external));
  const changed = changeParams(c);
  const outL = new Float32Array(PARITY_FRAMES);
  const outR = new Float32Array(PARITY_FRAMES);
  const meters: { input: number; gain: number; open: boolean }[] = [];
  let peak = 0;
  let minGain = 1;
  let count = 0;
  for (let start = 0; start < PARITY_FRAMES; start += PARITY_BLOCK) {
    if (c.change && changed && start === c.change.at) k.set(gateSettingsFromParams(changed, c.external));
    const n = Math.min(PARITY_BLOCK, PARITY_FRAMES - start);
    const part = (a: Float32Array) => a.subarray(start, start + n);
    const r = k.process(
      part(sig.inL),
      c.input === "stereo" ? part(sig.inR) : null,
      part(outL),
      part(outR),
      n,
      c.key === "none" ? null : part(sig.keyL),
      c.key === "stereo" ? part(sig.keyR) : null
    );
    if (r.peakIn > peak) peak = r.peakIn;
    if (r.minGain < minGain) minGain = r.minGain;
    count += n;
    if (count >= GATE_PARITY_METER_INTERVAL) {
      meters.push({ input: peak, gain: minGain, open: k.open });
      peak = 0;
      minGain = 1;
      count = 0;
    }
  }
  return { outL, outR, meters };
}

const pascal = (c: Channels) => c[0].toUpperCase() + c.slice(1);
const rustParams = (p: Record<string, number>) => `&[${Object.entries(p).map(([k, v]) => `("${k}", ${rustF64(v)})`).join(", ")}]`;

function rustCase(c: GateParityCase): string {
  const changed = changeParams(c);
  return [
    "    Case {",
    `        name: "${c.name}",`,
    `        params: ${rustParams(caseParams(c))},`,
    `        external: ${c.external},`,
    `        input: Channels::${pascal(c.input)},`,
    `        key: Channels::${pascal(c.key)},`,
    `        change: ${c.change && changed ? `Some((${c.change.at}, ${rustParams(changed)}))` : "None"},`,
    "    },",
  ].join("\n");
}

/** The fixture as it should be now: the Rust file's text, and the data
 * (per case: the kept left and right samples, then each meter reading's
 * key peak, lowest gain and whether the gate was open). */
export function renderGateParity(): { rust: string; data: FixtureData } {
  const sig = paritySignal();
  const data = new FixtureData();
  for (const c of GATE_PARITY_CASES) {
    const { outL, outR, meters } = renderCase(c, sig);
    for (const out of [outL, outR]) data.f32(out.filter((_, i) => i % PARITY_STRIDE === 0));
    data.f64(meters.flatMap((m) => [m.input, m.gain, m.open ? 1 : 0]));
  }
  const rust = [
    "// @generated by src/effects/gate/gateParity.test.ts from the",
    "// JavaScript kernel (gateModel.ts). Don't edit it: to remake it,",
    "// run UPDATE_ENGINE_FIXTURES=1 npx vitest run --project unit gateParity",
    "",
    `const SAMPLE_RATE: f64 = ${rustF64(PARITY_SAMPLE_RATE)};`,
    `const FRAMES: usize = ${PARITY_FRAMES};`,
    `const BLOCK: usize = ${PARITY_BLOCK};`,
    `const STRIDE: usize = ${PARITY_STRIDE};`,
    `const METER_INTERVAL: usize = ${GATE_PARITY_METER_INTERVAL};`,
    `const SIGNAL_HASH: u32 = ${rustHex(fnv1a([sig.inL, sig.inR, sig.keyL, sig.keyR]))};`,
    "",
    "const CASES: &[Case] = &[",
    ...GATE_PARITY_CASES.map(rustCase),
    "];",
    "",
  ].join("\n");
  return { rust, data };
}
