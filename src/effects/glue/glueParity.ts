// The Glue Compressor's parity fixture for its Rust port
// (crates/dawn-engine/src/effects/glue.rs): the cases, rendered with the
// worklet's own kernel (glueModel.ts) the way the worklet runs it
// (glue.ts), as a generated Rust file and the rendered samples and meters.
// glueParity.test.ts checks the stored fixture still matches; the Rust
// side's tests/glue_parity.rs compares the port against it. See
// src/test/kernelParity.ts.

import { GLUE_SOURCE, glueSettingsFromParams, type GlueSettings } from "./glueModel";
import { FixtureData, PARITY_BLOCK, PARITY_FRAMES, PARITY_SAMPLE_RATE, PARITY_STRIDE, fnv1a, paritySignal, rustF64, rustHex, type ParitySignal } from "../../test/kernelParity";

interface Meters {
  gainReduction: number;
  output: number;
  input: number;
  clipping: boolean;
}

interface Kernel {
  set(s: GlueSettings): void;
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

const Glue = new Function(`${GLUE_SOURCE}; return GlueKernel;`)() as new (sr: number) => Kernel;

/** How often (frames) the worklet reads the meters (glue.ts). */
export const GLUE_PARITY_METER_INTERVAL = 512;

type Channels = "none" | "mono" | "stereo";

export interface GlueParityCase {
  name: string;
  /** Over BASE_PARAMS. */
  params: Record<string, number>;
  external: boolean;
  input: Exclude<Channels, "none">;
  key: Channels;
  /** New parameters (over the case's) from this frame on - a block start. */
  change?: { at: number; params: Record<string, number> };
}

/** The Glue Compressor's defaults when the fixture was made. */
const BASE_PARAMS: Record<string, number> = {
  threshold: -10,
  ratio: 1,
  attack: 5,
  release: 6,
  makeup: 0,
  range: -70,
  dryWet: 1,
  softClip: 0,
  oversample: 0,
  scGain: 0,
  scHpf: 20,
  scLpf: 20000,
  scListen: 0,
  scMix: 1,
};

const base = { params: {}, external: false, input: "stereo", key: "none" } as const;

export const GLUE_PARITY_CASES: GlueParityCase[] = [
  { ...base, name: "defaults" },
  { ...base, name: "hard-fast", params: { threshold: -30, ratio: 2, attack: 0, release: 0, makeup: 8 } },
  { ...base, name: "auto-release-range", params: { threshold: -28, ratio: 1, attack: 3, release: 6, range: -6 } },
  { ...base, name: "soft-clip", params: { threshold: -20, makeup: 18, softClip: 1, dryWet: 0.7 } },
  { ...base, name: "oversampled-clip", params: { threshold: -24, makeup: 14, softClip: 1, oversample: 1, attack: 1, release: 2 } },
  { ...base, name: "sidechain-mix", params: { threshold: -26, scMix: 0.5, scHpf: 120 }, external: true, key: "stereo" },
  { ...base, name: "mono-key-mono-in", params: { threshold: -22, ratio: 2 }, external: true, input: "mono", key: "mono" },
  { ...base, name: "listen", params: { scListen: 1, scLpf: 2500 } },
  {
    ...base,
    name: "oversampling-switched-on",
    params: { threshold: -18, makeup: 6 },
    change: { at: 64 * PARITY_BLOCK, params: { oversample: 1, softClip: 1, makeup: 12, dryWet: 0.5, release: 3 } },
  },
];

const caseParams = (c: GlueParityCase) => ({ ...BASE_PARAMS, ...c.params });
const changeParams = (c: GlueParityCase) => (c.change ? { ...caseParams(c), ...c.change.params } : null);

function renderCase(c: GlueParityCase, sig: ParitySignal) {
  const k = new Glue(PARITY_SAMPLE_RATE);
  k.set(glueSettingsFromParams(caseParams(c), c.external));
  const changed = changeParams(c);
  const outL = new Float32Array(PARITY_FRAMES);
  const outR = new Float32Array(PARITY_FRAMES);
  const meters: Meters[] = [];
  let count = 0;
  for (let start = 0; start < PARITY_FRAMES; start += PARITY_BLOCK) {
    if (c.change && changed && start === c.change.at) k.set(glueSettingsFromParams(changed, c.external));
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
    if (count >= GLUE_PARITY_METER_INTERVAL) {
      count = 0;
      meters.push(k.takeMeters());
    }
  }
  return { outL, outR, meters };
}

const pascal = (c: Channels) => c[0].toUpperCase() + c.slice(1);
const rustParams = (p: Record<string, number>) => `&[${Object.entries(p).map(([k, v]) => `("${k}", ${rustF64(v)})`).join(", ")}]`;

function rustCase(c: GlueParityCase): string {
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
 * gain reduction, output, input and whether it clipped). */
export function renderGlueParity(): { rust: string; data: FixtureData } {
  const sig = paritySignal();
  const data = new FixtureData();
  for (const c of GLUE_PARITY_CASES) {
    const { outL, outR, meters } = renderCase(c, sig);
    for (const out of [outL, outR]) data.f32(out.filter((_, i) => i % PARITY_STRIDE === 0));
    data.f64(meters.flatMap((m) => [m.gainReduction, m.output, m.input, m.clipping ? 1 : 0]));
  }
  const rust = [
    "// @generated by src/effects/glue/glueParity.test.ts from the",
    "// JavaScript kernel (glueModel.ts). Don't edit it: to remake it,",
    "// run UPDATE_ENGINE_FIXTURES=1 npx vitest run --project unit glueParity",
    "",
    `const SAMPLE_RATE: f64 = ${rustF64(PARITY_SAMPLE_RATE)};`,
    `const FRAMES: usize = ${PARITY_FRAMES};`,
    `const BLOCK: usize = ${PARITY_BLOCK};`,
    `const STRIDE: usize = ${PARITY_STRIDE};`,
    `const METER_INTERVAL: usize = ${GLUE_PARITY_METER_INTERVAL};`,
    `const SIGNAL_HASH: u32 = ${rustHex(fnv1a([sig.inL, sig.inR, sig.keyL, sig.keyR]))};`,
    "",
    "const CASES: &[Case] = &[",
    ...GLUE_PARITY_CASES.map(rustCase),
    "];",
    "",
  ].join("\n");
  return { rust, data };
}
