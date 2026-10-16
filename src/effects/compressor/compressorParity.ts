// The Compressor's parity fixture for its Rust port
// (crates/dawn-engine/src/effects/compressor.rs): the cases, rendered with
// this kernel the way its worklet runs it (compressor.ts), as a generated
// Rust file and the rendered samples and meters. compressorParity.test.ts
// checks the stored fixture still matches this kernel, or rewrites it; the
// Rust side's tests/compressor_parity.rs compares the port against it. See
// src/test/kernelParity.ts.

import { COMPRESSOR_SOURCE, compressorSettingsFromParams, type CompressorSettings } from "./compressorModel";
import {
  FixtureData,
  PARITY_BLOCK,
  PARITY_FRAMES,
  PARITY_METER_INTERVAL,
  PARITY_SAMPLE_RATE,
  PARITY_STRIDE,
  fnv1a,
  paritySignal,
  rustF64,
  rustHex,
  type ParitySignal,
} from "../../test/kernelParity";

interface Meters {
  input: number;
  output: number;
  key: number;
  gainReduction: number;
}

interface Kernel {
  set(s: CompressorSettings): void;
  process(
    inL: Float32Array | null,
    inR: Float32Array | null,
    keyL: Float32Array | null,
    keyR: Float32Array | null,
    outL: Float32Array,
    outR: Float32Array | null,
    n: number
  ): void;
  takeMeters(): Meters;
}

const { CompressorKernel } = new Function(`${COMPRESSOR_SOURCE}; return { CompressorKernel };`)() as {
  CompressorKernel: new (sampleRate: number) => Kernel;
};

/** Which channels of a stream are connected. */
type Channels = "none" | "mono" | "stereo";

export interface CompressorParityCase {
  name: string;
  /** Over BASE_PARAMS. */
  params: Record<string, number>;
  /** A sidechain source is connected. */
  external: boolean;
  input: Exclude<Channels, "none">;
  key: Channels;
  /** New parameters (over the case's) from this frame on - a block start. */
  change?: { at: number; params: Record<string, number> };
}

/** The parameters every case starts from: the Compressor's defaults when
 * the fixture was made (kept here, so changing a default in index.ts
 * doesn't change the fixture). */
const BASE_PARAMS: Record<string, number> = {
  threshold: -24,
  ratio: 4,
  attack: 0.02,
  release: 0.2,
  knee: 6,
  makeup: 0,
  makeupAuto: 1,
  dryWet: 1,
  output: 0,
  scGain: 0,
  scHpf: 20,
  scLpf: 20000,
  scListen: 0,
};

const base = { params: {}, external: false, input: "stereo", key: "none" } as const;

export const COMPRESSOR_PARITY_CASES: CompressorParityCase[] = [
  { ...base, name: "defaults" },
  {
    ...base,
    name: "fast-hard-manual-makeup",
    params: { threshold: -36, ratio: 20, attack: 0.001, release: 0.03, knee: 0, makeupAuto: 0, makeup: 9, output: -3 },
  },
  {
    ...base,
    name: "parallel-wide-knee",
    params: { threshold: -30, ratio: 2.5, knee: 18, attack: 0.005, release: 0.4, dryWet: 0.4 },
  },
  {
    ...base,
    name: "sidechain-filtered",
    params: { threshold: -20, ratio: 8, scGain: 6, scHpf: 150, scLpf: 3000 },
    external: true,
    key: "stereo",
  },
  {
    ...base,
    name: "sidechain-mono-key-mono-in",
    params: { threshold: -28, ratio: 10, release: 0.08 },
    external: true,
    input: "mono",
    key: "mono",
  },
  { ...base, name: "sidechain-unplugged", params: { threshold: -40 }, external: true },
  { ...base, name: "listen-low-cut", params: { scHpf: 400, scListen: 1 } },
  {
    ...base,
    name: "settings-change",
    change: {
      at: 75 * PARITY_BLOCK,
      params: { threshold: -42, ratio: 6, makeupAuto: 0, makeup: -4, dryWet: 0.6, output: 4, scHpf: 250 },
    },
  },
];

function caseParams(c: CompressorParityCase): Record<string, number> {
  return { ...BASE_PARAMS, ...c.params };
}

function changeParams(c: CompressorParityCase): Record<string, number> | null {
  return c.change ? { ...caseParams(c), ...c.change.params } : null;
}

/** Renders a case as the worklet would: blocks of PARITY_BLOCK, meters read
 * every PARITY_METER_INTERVAL frames. */
function renderCase(c: CompressorParityCase, sig: ParitySignal): { outL: Float32Array; outR: Float32Array; meters: Meters[] } {
  const kernel = new CompressorKernel(PARITY_SAMPLE_RATE);
  kernel.set(compressorSettingsFromParams(caseParams(c), c.external));
  const changed = changeParams(c);
  const outL = new Float32Array(PARITY_FRAMES);
  const outR = new Float32Array(PARITY_FRAMES);
  const meters: Meters[] = [];
  let count = 0;
  for (let start = 0; start < PARITY_FRAMES; start += PARITY_BLOCK) {
    if (c.change && changed && start === c.change.at) kernel.set(compressorSettingsFromParams(changed, c.external));
    const n = Math.min(PARITY_BLOCK, PARITY_FRAMES - start);
    const part = (a: Float32Array) => a.subarray(start, start + n);
    kernel.process(
      part(sig.inL),
      c.input === "stereo" ? part(sig.inR) : null,
      c.key === "none" ? null : part(sig.keyL),
      c.key === "stereo" ? part(sig.keyR) : null,
      part(outL),
      part(outR),
      n
    );
    count += n;
    if (count >= PARITY_METER_INTERVAL) {
      count = 0;
      meters.push(kernel.takeMeters());
    }
  }
  return { outL, outR, meters };
}

const pascal = (c: Channels) => c[0].toUpperCase() + c.slice(1);

function rustParams(p: Record<string, number>): string {
  return `&[${Object.entries(p)
    .map(([k, v]) => `("${k}", ${rustF64(v)})`)
    .join(", ")}]`;
}

function rustSettings(s: CompressorSettings, indent: string): string {
  const i2 = `${indent}    `;
  return [
    "CompressorSettings {",
    `${i2}key: KeySettings { external: ${s.external}, sc_gain_db: ${rustF64(s.scGainDb)}, sc_hpf: ${rustF64(s.scHpf)}, sc_lpf: ${rustF64(s.scLpf)}, listen: ${s.listen} },`,
    `${i2}threshold: ${rustF64(s.threshold)},`,
    `${i2}ratio: ${rustF64(s.ratio)},`,
    `${i2}knee: ${rustF64(s.knee)},`,
    `${i2}attack: ${rustF64(s.attack)},`,
    `${i2}release: ${rustF64(s.release)},`,
    `${i2}makeup_db: ${rustF64(s.makeupDb)},`,
    `${i2}dry_wet: ${rustF64(s.dryWet)},`,
    `${i2}output_db: ${rustF64(s.outputDb)},`,
    `${indent}}`,
  ].join("\n");
}

function rustCase(c: CompressorParityCase): string {
  const params = caseParams(c);
  const changed = changeParams(c);
  const change =
    c.change && changed
      ? [
          "Some(Change {",
          `            at: ${c.change.at},`,
          `            params: ${rustParams(changed)},`,
          `            settings: ${rustSettings(compressorSettingsFromParams(changed, c.external), "            ")},`,
          "        })",
        ].join("\n")
      : "None";
  return [
    "    Case {",
    `        name: "${c.name}",`,
    `        params: ${rustParams(params)},`,
    `        external: ${c.external},`,
    `        input: Channels::${pascal(c.input)},`,
    `        key: Channels::${pascal(c.key)},`,
    `        settings: ${rustSettings(compressorSettingsFromParams(params, c.external), "        ")},`,
    `        change: ${change},`,
    "    },",
  ].join("\n");
}

/** The fixture as it should be now: the Rust file's text, and the data
 * (per case: the kept left and right samples, then each meter reading's
 * input, output, key and gain reduction). */
export function renderCompressorParity(): { rust: string; data: FixtureData } {
  const sig = paritySignal();
  const data = new FixtureData();
  for (const c of COMPRESSOR_PARITY_CASES) {
    const { outL, outR, meters } = renderCase(c, sig);
    for (const out of [outL, outR]) data.f32(out.filter((_, i) => i % PARITY_STRIDE === 0));
    data.f64(meters.flatMap((m) => [m.input, m.output, m.key, m.gainReduction]));
  }
  const rust = [
    "// @generated by src/effects/compressor/compressorParity.test.ts from the",
    "// JavaScript kernel (compressorModel.ts). Don't edit it: to remake it,",
    "// run UPDATE_ENGINE_FIXTURES=1 npx vitest run --project unit compressorParity",
    "",
    `const SAMPLE_RATE: f64 = ${rustF64(PARITY_SAMPLE_RATE)};`,
    `const FRAMES: usize = ${PARITY_FRAMES};`,
    `const BLOCK: usize = ${PARITY_BLOCK};`,
    `const STRIDE: usize = ${PARITY_STRIDE};`,
    `const METER_INTERVAL: usize = ${PARITY_METER_INTERVAL};`,
    `const SIGNAL_HASH: u32 = ${rustHex(fnv1a([sig.inL, sig.inR, sig.keyL, sig.keyR]))};`,
    "",
    "const CASES: &[Case] = &[",
    ...COMPRESSOR_PARITY_CASES.map(rustCase),
    "];",
    "",
  ].join("\n");
  return { rust, data };
}
