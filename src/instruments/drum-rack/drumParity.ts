// The Drum Rack's parity fixture for its Rust port
// (crates/dawn-engine/src/instruments/drums.rs): kits and hits, rendered by
// the worklet's own kernel (drumKernel.ts) the way the worklet runs it, as
// a generated Rust file and the rendered samples. drumParity.test.ts checks
// the stored fixture still matches; the Rust side's tests/drum_parity.rs
// compares the port against it. See src/test/kernelParity.ts.

import { DRUM_SOURCE } from "./drumKernel";
import { compileDrumKit, defaultDrumKit, padNote, type DrumKitParams } from "./drumParams";
import { FixtureData, PARITY_BLOCK, PARITY_FRAMES, PARITY_SAMPLE_RATE, PARITY_STRIDE, fnv1a, paritySignal, rustF64, rustHex, type ParitySignal } from "../../test/kernelParity";

interface Kernel {
  setSettings(s: unknown): void;
  setSample(pad: number, data: Float32Array[] | null): void;
  addEvent(e: { type: string; note?: number; vel?: number; time: number }): void;
  process(outL: Float32Array, outR: Float32Array, n: number, now: number): void;
  takeState(): { hits: number; peak: number; voices: number };
}

const Drums = new Function(`${DRUM_SOURCE}; return DawnDrumKernel;`)() as new (sr: number) => Kernel;

/** The clock time (s) the renders start at: not 0, so the events' times
 * are turned into frames the way they are in a running worklet. */
export const DRUM_PARITY_START = 1.25;

/** A sample for a pad, cut from the test signal. */
type SampleSlice = { from: "in" | "key"; start: number; end: number };

export interface DrumParityEvent {
  /** Frames after the start. */
  at: number;
  /** A pad's hit, or every voice fading out. */
  pad?: number;
  /** A note outside the pads (ignored). */
  note?: number;
  vel?: number;
  panic?: boolean;
}

export interface DrumParityCase {
  name: string;
  kit: DrumKitParams;
  samples: (SampleSlice | null)[];
  events: DrumParityEvent[];
}

function kitCase(): DrumParityCase {
  const kit = defaultDrumKit();
  kit.volume = -3;
  const p = kit.pads;
  p[0].drive = 0.6;
  p[2].filter = -0.4;
  p[2].resonance = 0.5;
  p[4].filter = 0.3;
  p[5].pan = -0.7;
  p[7].pan = 0.5;
  p[7].velocity = 1;
  p[13].filter = -0.2;
  p[13].drive = 0.3;
  p[3].mute = true;
  const hits: [number, number, number][] = [
    [0, 0, 0.9],
    [2, 211, 0.8],
    [4, 523, 0.7],
    [6, 1001, 0.6],
    [10, 1500, 1],
    [6, 2600, 0.5],
    [1, 3000, 0.9],
    [5, 3333, 0.8],
    [7, 3777, 0.3],
    [9, 4100, 1],
    [11, 4500, 0.7],
    [12, 5000, 0.9],
    [13, 5600, 1],
    [14, 6200, 0.6],
    [15, 6800, 0.8],
    [3, 7400, 1],
    [8, 8000, 0.7],
    ...Array.from({ length: 6 }, (_, i) => [2, 9000 + 37 * i, 0.5 + i * 0.08] as [number, number, number]),
  ];
  return {
    name: "kit",
    kit,
    samples: [],
    events: [...hits.map(([pad, at, vel]) => ({ pad, at, vel })), { note: 10, at: 9500, vel: 1 }, { panic: true, at: 15000 }],
  };
}

function samplesCase(): DrumParityCase {
  const kit = defaultDrumKit();
  const p = kit.pads;
  const sample = { id: "parity", name: "parity" };
  Object.assign(p[0], { source: "sample", sample, decay: 1 });
  Object.assign(p[1], { source: "sample", sample, tune: 7, reverse: true, decay: 0.5 });
  Object.assign(p[2], { source: "sample", sample, tune: -5, start: 0.3, filter: -0.3, drive: 0.4, pan: 0.4 });
  // A sample pad whose file hasn't loaded: its hits are skipped.
  Object.assign(p[3], { source: "sample", sample });
  return {
    name: "samples",
    kit,
    samples: [{ from: "in", start: 2400, end: 7200 }, { from: "key", start: 0, end: 3600 }, { from: "in", start: 2400, end: 7200 }, null],
    events: [
      { pad: 0, at: 100, vel: 0.9 },
      { pad: 1, at: 2000, vel: 0.8 },
      { pad: 2, at: 4000, vel: 1 },
      { pad: 3, at: 5000, vel: 1 },
      { pad: 0, at: 9000, vel: 0.4 },
      { pad: 1, at: 12000, vel: 0.6 },
    ],
  };
}

export const DRUM_PARITY_CASES: DrumParityCase[] = [kitCase(), samplesCase()];

function sampleData(slice: SampleSlice, sig: ParitySignal): Float32Array[] {
  return slice.from === "in" ? [sig.inL.slice(slice.start, slice.end), sig.inR.slice(slice.start, slice.end)] : [sig.keyL.slice(slice.start, slice.end)];
}

function renderCase(c: DrumParityCase, sig: ParitySignal) {
  const k = new Drums(PARITY_SAMPLE_RATE);
  k.setSettings(compileDrumKit(c.kit));
  c.samples.forEach((s, i) => k.setSample(i, s ? sampleData(s, sig) : null));
  for (const e of c.events) {
    const time = DRUM_PARITY_START + e.at / PARITY_SAMPLE_RATE;
    if (e.panic) k.addEvent({ type: "panic", time });
    else k.addEvent({ type: "on", note: e.note ?? padNote(e.pad ?? 0), vel: e.vel, time });
  }
  const outL = new Float32Array(PARITY_FRAMES);
  const outR = new Float32Array(PARITY_FRAMES);
  const bl = new Float32Array(PARITY_BLOCK);
  const br = new Float32Array(PARITY_BLOCK);
  for (let i = 0; i < PARITY_FRAMES; i += PARITY_BLOCK) {
    const n = Math.min(PARITY_BLOCK, PARITY_FRAMES - i);
    k.process(bl, br, n, DRUM_PARITY_START + i / PARITY_SAMPLE_RATE);
    outL.set(bl.subarray(0, n), i);
    outR.set(br.subarray(0, n), i);
  }
  return { outL, outR, state: k.takeState() };
}

const strided = (a: Float32Array) => a.filter((_, i) => i % PARITY_STRIDE === 0);

function rustKit(kit: DrumKitParams): string {
  const compiled = compileDrumKit(kit);
  const pads = compiled.pads.map(
    (p) =>
      `                Pad { on: ${p.on}, sample: ${p.sample}, model: ${p.model}, tune: ${rustF64(p.tune)}, decay: ${rustF64(p.decay)}, ` +
      `tone: ${rustF64(p.tone)}, character: ${rustF64(p.character)}, drive: ${rustF64(p.drive)}, start: ${rustF64(p.start)}, ` +
      `reverse: ${p.reverse}, gain: ${rustF64(p.gain)}, pan: ${rustF64(p.pan)}, filter: ${rustF64(p.filter)}, ` +
      `resonance: ${rustF64(p.resonance)}, velocity: ${rustF64(p.velocity)}, choke: ${p.choke} },`
  );
  return [`        kit: DrumKit {`, `            pads: [`, ...pads, `            ],`, `            volume: ${rustF64(compiled.volume)},`, `        },`].join("\n");
}

function rustSample(s: SampleSlice | null): string {
  return s ? `Some(SampleSlice { from_key: ${s.from === "key"}, start: ${s.start}, end: ${s.end} })` : "None";
}

function rustEvent(e: DrumParityEvent): string {
  if (e.panic) return `Ev { at: ${e.at}, note: 0, vel: 0.0, panic: true }`;
  return `Ev { at: ${e.at}, note: ${e.note ?? padNote(e.pad ?? 0)}, vel: ${rustF64(e.vel ?? 0)}, panic: false }`;
}

/** The fixture: the Rust file (cases, kits, events) and the data (each
 * case's every PARITY_STRIDE-th output sample, left then right, and its
 * kernel's state at the end: pads hit, peak, voices). */
export function drumParityFixture(): { rust: string; data: FixtureData } {
  const sig = paritySignal();
  const data = new FixtureData();
  const cases = DRUM_PARITY_CASES.map((c) => {
    const r = renderCase(c, sig);
    data.f32(strided(r.outL));
    data.f32(strided(r.outR));
    data.f64([r.state.hits, r.state.peak, r.state.voices]);
    return [
      `    Case {`,
      `        name: ${JSON.stringify(c.name)},`,
      rustKit(c.kit),
      `        samples: &[${c.samples.map(rustSample).join(", ")}],`,
      `        events: &[${c.events.map(rustEvent).join(", ")}],`,
      `    },`,
    ].join("\n");
  });
  const rust = [
    "// @generated by src/instruments/drum-rack/drumParity.test.ts from the",
    "// JavaScript kernel (drumKernel.ts). Don't edit it: to remake it,",
    "// run UPDATE_ENGINE_FIXTURES=1 npx vitest run --project unit drumParity",
    "",
    `const SAMPLE_RATE: f64 = ${rustF64(PARITY_SAMPLE_RATE)};`,
    `const FRAMES: usize = ${PARITY_FRAMES};`,
    `const BLOCK: usize = ${PARITY_BLOCK};`,
    `const STRIDE: usize = ${PARITY_STRIDE};`,
    `const START: f64 = ${rustF64(DRUM_PARITY_START)};`,
    `const SIGNAL_HASH: u32 = ${rustHex(fnv1a([sig.inL, sig.inR, sig.keyL, sig.keyR]))};`,
    "const CASES: &[Case] = &[",
    ...cases,
    "];",
    "",
  ].join("\n");
  return { rust, data };
}
