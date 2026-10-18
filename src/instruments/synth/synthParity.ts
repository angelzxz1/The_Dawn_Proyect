// The synth's parity fixture for its Rust port
// (crates/dawn-engine/src/instruments/synth.rs): patches and notes, rendered
// by the worklet's own kernel (synthKernel.ts) the way the worklet runs it,
// as a generated Rust file and the rendered samples. synthParity.test.ts
// checks the stored fixture still matches; the Rust side's
// tests/synth_parity.rs compares the port against it. See
// src/test/kernelParity.ts.
//
// The wavetables are cut from the test signal (both sides make it), so
// only their sizes go in the fixture: what's checked is the kernel, not
// the tables (the same data reaches both).

import { SYNTH_SOURCE, SYNTH_STEP } from "./synthKernel";
import { compileSynth, defaultEnv, defaultLfo, DEST_SPECS, initSynthParams, newModId, type CompiledSynth, type ModDest, type ModSource, type SynthParams } from "./synthParams";
import { MIP_HARMONICS, MIP_SIZES, type WavetableData } from "./wavetableModel";
import { FixtureData, PARITY_BLOCK, PARITY_FRAMES, PARITY_SAMPLE_RATE, PARITY_STRIDE, fnv1a, paritySignal, rustF64, rustHex, type ParitySignal } from "../../test/kernelParity";

type SynthEvent = { type: "on" | "off" | "allOff" | "panic"; note?: number; vel?: number; time: number };

interface Kernel {
  bpm: number;
  bend: number;
  modwheel: number;
  setSettings(s: CompiledSynth): void;
  setTable(slot: number, data: WavetableData | null): void;
  addEvent(e: SynthEvent): void;
  process(outL: Float32Array, outR: Float32Array, n: number, now: number): void;
  takeState(): {
    voices: number;
    mod: number[] | null;
    env: [number, number][] | null;
    lfo: [number, number][];
    peak: [number, number];
  };
}

/** A kernel of its own (the source keeps its random numbers at the top
 * level, so each case starts them afresh, as the Rust port does). */
const newKernel = () => new (new Function(`${SYNTH_SOURCE}; return DawnSynthKernel;`)() as new (sr: number) => Kernel)(PARITY_SAMPLE_RATE);

/** The clock time (s) the renders start at: not 0, so the events' times
 * are turned into frames the way they are in a running worklet. */
export const SYNTH_PARITY_START = 1.25;

/** Frames per test table: oscillator 1's (cut from the left input),
 * oscillator 2's (the right input) and the sub's (the left key). */
export const SYNTH_TABLE_FRAMES = [3, 2, 4] as const;

const FRAME_SAMPLES = MIP_SIZES.reduce((n, size) => n + size, 0);

export interface SynthParityEvent {
  /** Frames after the start. */
  at: number;
  type: SynthEvent["type"];
  note?: number;
  vel?: number;
}

/** Between blocks: new settings, or the bend or mod wheel moving. */
export interface SynthParityChange {
  /** Frames after the start (a block's first). */
  at: number;
  params?: SynthParams;
  bend?: number;
  wheel?: number;
}

export interface SynthParityCase {
  name: string;
  params: SynthParams;
  /** Which tables it has (oscillator 1, oscillator 2, sub). */
  tables: [boolean, boolean, boolean];
  bpm: number;
  bend: number;
  wheel: number;
  events: SynthParityEvent[];
  changes: SynthParityChange[];
}

const on = (at: number, note: number, vel = 0.8): SynthParityEvent => ({ at, type: "on", note, vel });
const off = (at: number, note: number): SynthParityEvent => ({ at, type: "off", note });
const route = (source: ModSource, dest: ModDest, amount: number, bipolar = false) => ({ id: newModId(), source, dest, amount, bipolar });

function patch(edit: (p: SynthParams) => void): SynthParams {
  const p = initSynthParams();
  edit(p);
  return p;
}

function base(name: string, params: SynthParams, events: SynthParityEvent[]): SynthParityCase {
  return { name, params, tables: [true, true, true], bpm: 120, bend: 0, wheel: 0, events, changes: [] };
}

function polyCase(): SynthParityCase {
  const params = patch((p) => {
    Object.assign(p.osc1, { unison: 5, detune: 0.4, width: 0.8, blend: 0.6, randomPhase: 0.7, phase: 0.25 });
    Object.assign(p.osc2, { on: true, warp: "sync", warpAmount: 0.5, transpose: 7, fine: -12, level: 0.5, dest: "f2", position: 0.8 });
    Object.assign(p.filter1, { type: "lp24", cutoff: 3000, resonance: 0.5, keytrack: 0.5 });
    Object.assign(p.filter2, { on: true, type: "hp12", cutoff: 200, resonance: 0.3 });
    p.filterRouting = "parallel";
    p.envs[0] = defaultEnv({ attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.05, attackCurve: 0.3, decayCurve: -0.4, releaseCurve: 0.6 });
    p.envs[1] = defaultEnv({ attack: 0.02, decay: 0.15, sustain: 0.2, release: 0.1 });
    p.lfos[0] = defaultLfo({ shape: "sine", sync: true, division: 12, phase: 0.1 });
    p.mods = [route("env2", "filter1.cutoff", 0.4), route("lfo1", "osc1.position", 0.3, true), route("velocity", "osc2.level", 0.5), route("modwheel", "filter1.resonance", 0.3)];
    p.voice = { ...p.voice, velocity: 0.8, polyphony: 8 };
  });
  return {
    ...base("poly", params, [
      on(0, 60, 0.9),
      on(0, 64, 0.7),
      on(0, 67, 0.8),
      on(3000, 72, 0.5),
      off(6000, 60),
      off(6000, 64),
      off(6000, 67),
      off(9000, 72),
      on(10000, 60, 1),
      // The same note again while it's held: the same voice starts over.
      on(10500, 60, 0.6),
      { at: 15000, type: "allOff" },
    ]),
    bpm: 140,
    bend: 0.25,
    wheel: 0.3,
  };
}

function bendSqueezeCase(): SynthParityCase {
  const params = patch((p) => {
    Object.assign(p.osc1, { warp: "bend", warpAmount: 0.6, unison: 2 });
    Object.assign(p.osc2, { on: true, warp: "squeeze", warpAmount: 0.4, dest: "both", level: 0.6 });
    Object.assign(p.filter1, { type: "ladder", cutoff: 1500, resonance: 0.7, drive: 0.5 });
    Object.assign(p.filter2, { on: true, type: "morph", cutoff: 5000, resonance: 0.4, morph: 0.4 });
    p.envs[0] = defaultEnv({ release: 0.08 });
    p.lfos[1] = defaultLfo({ shape: "triangle", sync: false, rate: 5, mode: "free" });
    p.lfos[2] = defaultLfo({ shape: "saw", sync: false, rate: 3 });
    p.mods = [route("lfo2", "osc1.warpAmount", 0.3, true), route("lfo3", "filter2.morph", 0.4)];
  });
  return base("bend and squeeze, ladder into morph", params, [on(0, 48), on(2000, 55, 0.6), off(12000, 48), off(14000, 55)]);
}

function pulseMirrorCase(): SynthParityCase {
  const params = patch((p) => {
    Object.assign(p.osc1, { warp: "pulse", warpAmount: 0.5 });
    Object.assign(p.osc2, { on: true, warp: "mirror", warpAmount: 0.7, dest: "direct", pan: -0.4, unison: 3, level: 0.4 });
    p.sub = { on: true, shape: "square", octave: -2, level: 0.4, pan: 0, dest: "f2" };
    Object.assign(p.filter1, { type: "bp", cutoff: 1200, resonance: 0.6 });
    Object.assign(p.filter2, { on: true, type: "notch", cutoff: 800, resonance: 0.5 });
    p.filterRouting = "parallel";
    p.envs[2] = defaultEnv({ attack: 0.05, decay: 0.2, sustain: 0.3 });
    p.lfos[0] = defaultLfo({ shape: "ramp", sync: false, rate: 7 });
    p.mods = [route("env3", "osc1.position", 0.6), route("lfo1", "sub.pan", 0.5, true)];
  });
  return base("pulse and mirror, band and notch", params, [on(500, 57), on(600, 64), on(700, 69, 0.4), off(11000, 57), off(11000, 64), off(13000, 69)]);
}

function foldQuantizeCase(): SynthParityCase {
  const params = patch((p) => {
    Object.assign(p.osc1, { warp: "fold", warpAmount: 0.8 });
    Object.assign(p.osc2, { on: true, warp: "quantize", warpAmount: 0.5, dest: "f2", position: 0.3 });
    p.noise = { on: true, color: "white", level: 0.1, pan: 0.5, dest: "direct" };
    Object.assign(p.filter1, { type: "comb", cutoff: 300, resonance: 0.8, morph: 0.3, drive: 0.3, mix: 0.8 });
    Object.assign(p.filter2, { on: true, type: "combNeg", cutoff: 600, resonance: 0.6, morph: 0.1 });
    p.filterRouting = "parallel";
    p.lfos[0] = defaultLfo({ shape: "square", sync: true, division: 10 });
    p.mods = [route("lfo1", "filter1.cutoff", 0.2, true)];
  });
  return base("fold and quantize, the combs", params, [on(0, 45), on(4000, 52, 0.5), off(9000, 52), off(15000, 45)]);
}

function fmRingCase(): SynthParityCase {
  const params = patch((p) => {
    // Oscillator 1 is the modulated one, so oscillator 2 renders first
    // (and rings with what oscillator 1 played the segment before).
    Object.assign(p.osc1, { warp: "fm", warpAmount: 0.5 });
    Object.assign(p.osc2, { on: true, warp: "rm", warpAmount: 0.6, dest: "f1", transpose: 12 });
    Object.assign(p.filter1, { type: "formant", morph: 0.6, resonance: 0.5, drive: 0.4, cutoff: 1500 });
    Object.assign(p.filter2, { on: true, type: "lp12", cutoff: 4000 });
    p.lfos[0] = defaultLfo({ shape: "stepped", sync: true, division: 10 });
    p.mods = [route("lfo1", "filter1.morph", 0.3, true), route("random", "osc1.warpAmount", 0.2, true)];
  });
  return base("fm and ring, vowels into a low pass", params, [on(100, 50), on(3000, 62, 0.7), off(8000, 62), off(16000, 50)]);
}

function ringFmCase(): SynthParityCase {
  const params = patch((p) => {
    // Oscillator 2 renders first and is modulated by what oscillator 1
    // played the segment before; oscillator 1 rings with it.
    Object.assign(p.osc1, { warp: "rm", warpAmount: 0.5 });
    Object.assign(p.osc2, { on: true, warp: "fm", warpAmount: 0.7, unison: 2 });
    Object.assign(p.filter1, { type: "lp12", cutoff: 6000 });
  });
  return base("ring and fm", params, [on(0, 53), off(10000, 53)]);
}

function sourcesCase(): SynthParityCase {
  const params = patch((p) => {
    Object.assign(p.osc1, { unison: 3, dest: "f2", detune: 0.6 });
    p.sub = { on: true, shape: "saw", octave: -1, level: 0.6, pan: -0.3, dest: "f1" };
    p.noise = { on: true, color: "pink", level: 0.3, pan: 0, dest: "both" };
    Object.assign(p.filter1, { type: "hp24", cutoff: 400, resonance: 0.6 });
    Object.assign(p.filter2, { on: true, type: "lp12", cutoff: 2500 });
    p.filterRouting = "parallel";
    p.envs[0] = defaultEnv({ delay: 0.01, hold: 0.02, release: 0.05 });
    p.lfos[2] = defaultLfo({ shape: "smooth", sync: false, rate: 6, mode: "free" });
    p.macros = [0.3, 0.6, 0, 0.9];
    p.mods = [route("lfo3", "noise.level", 0.3), route("random", "sub.pan", 0.4, true), route("macro1", "voice.volume", 0.2), route("macro2", "osc1.detune", -0.3), route("note", "filter2.cutoff", 0.1)];
  });
  return base("sub and noise", params, [on(0, 40), on(1000, 47), off(8000, 40), on(9000, 52, 0.3), off(12000, 52), off(19000, 47)]);
}

function monoCase(): SynthParityCase {
  const params = patch((p) => {
    Object.assign(p.filter1, { type: "lp12", cutoff: 2000 });
    p.envs[0] = defaultEnv({ delay: 0.005, attack: 0.005, hold: 0.01, release: 0.06 });
    p.lfos[0] = defaultLfo({ shape: "sine", sync: true, division: 14, mode: "once", fade: 0.1 });
    p.lfos[1] = defaultLfo({ shape: "sine", sync: true, division: 7, mode: "free" });
    p.mods = [route("lfo1", "osc1.fine", 0.4, true), route("lfo2", "filter1.cutoff", 0.2, true)];
    p.voice = { ...p.voice, mode: "mono", glide: 0.05 };
  });
  return base("mono with glide", params, [
    on(0, 60),
    on(2000, 64),
    on(4000, 67),
    // Back down the held notes.
    off(6000, 67),
    off(8000, 64),
    off(10000, 60),
    on(12000, 62),
    off(16000, 62),
    on(17000, 70),
  ]);
}

function legatoCase(): SynthParityCase {
  const params = patch((p) => {
    Object.assign(p.osc2, { on: true, warp: "sync", warpAmount: 0.3, dest: "f1" });
    p.envs[0] = defaultEnv({ release: 0.1 });
    p.lfos[0] = defaultLfo({ shape: "triangle", sync: false, rate: 4, mode: "free" });
    p.mods = [route("lfo1", "osc2.warpAmount", 0.3, true), route("bend", "osc2.position", 0.5, true)];
    p.voice = { ...p.voice, mode: "legato" };
  });
  return {
    ...base("legato, then panic", params, [on(0, 55), on(3000, 59), on(5000, 62), off(7000, 59), off(9000, 55), { at: 15000, type: "panic" }, on(16000, 65), off(18000, 65)]),
    bend: -0.5,
  };
}

function stealCase(): SynthParityCase {
  const first = patch((p) => {
    Object.assign(p.osc1, { unison: 2 });
    Object.assign(p.filter1, { type: "lp12", cutoff: 3000, resonance: 0.4 });
    p.envs[0] = defaultEnv({ release: 0.2 });
    p.mods = [route("bend", "filter1.cutoff", 0.2, true), route("modwheel", "osc1.position", 0.4)];
    p.voice = { ...p.voice, polyphony: 2 };
  });
  // More unison voices (new ones start at random phases), then another
  // filter type (its state starts over) in series with a second.
  const wider = structuredClone(first);
  Object.assign(wider.osc1, { unison: 4, phase: 0.5 });
  const other = structuredClone(wider);
  other.filter1.type = "hp12";
  Object.assign(other.filter2, { on: true, type: "lp24", cutoff: 5000 });
  other.filterRouting = "serial";
  return {
    ...base("stealing, and changes while playing", first, [
      on(0, 60),
      on(200, 62),
      on(400, 64),
      on(600, 65),
      on(3000, 67),
      off(5000, 60),
      off(5000, 62),
      off(5000, 64),
      off(5000, 65),
      on(7000, 69),
      on(7100, 71),
      off(11000, 69),
      off(11000, 71),
      off(11000, 67),
      on(13000, 72),
    ]),
    changes: [
      { at: 6400, params: wider },
      { at: 9600, params: other },
      { at: 12800, bend: -0.5, wheel: 0.8 },
    ],
  };
}

function missingCase(): SynthParityCase {
  const params = patch((p) => {
    Object.assign(p.osc2, { on: true, dest: "f1" });
    p.sub = { on: true, shape: "sine", octave: -1, level: 0.5, pan: 0.2, dest: "direct" };
    Object.assign(p.filter1, { type: "lp12", cutoff: 2500 });
  });
  return { ...base("oscillator 2 without its table", params, [on(0, 55), off(10000, 55)]), tables: [true, false, true] };
}

export const SYNTH_PARITY_CASES: SynthParityCase[] = [
  polyCase(),
  bendSqueezeCase(),
  pulseMirrorCase(),
  foldQuantizeCase(),
  fmRingCase(),
  ringFmCase(),
  sourcesCase(),
  monoCase(),
  legatoCase(),
  stealCase(),
  missingCase(),
];

/** A table of `frames` frames from the start of `source`, its levels one
 * after another. */
function table(source: Float32Array, frames: number): WavetableData {
  const levels: Float32Array[] = [];
  let at = 0;
  for (const size of MIP_SIZES) {
    levels.push(source.slice(at, at + frames * size));
    at += frames * size;
  }
  return { frames, levels };
}

function tables(sig: ParitySignal): WavetableData[] {
  const sources = [sig.inL, sig.inR, sig.keyL];
  return SYNTH_TABLE_FRAMES.map((frames, i) => {
    if (frames * FRAME_SAMPLES > sources[i].length) throw new Error("The test signal is too short for the tables.");
    return table(sources[i], frames);
  });
}

function renderCase(c: SynthParityCase, data: WavetableData[]) {
  const k = newKernel();
  k.bpm = c.bpm;
  k.bend = c.bend;
  k.modwheel = c.wheel;
  c.tables.forEach((has, i) => has && k.setTable(i, data[i]));
  k.setSettings(compileSynth(c.params));
  for (const e of c.events) k.addEvent({ type: e.type, note: e.note, vel: e.vel, time: SYNTH_PARITY_START + e.at / PARITY_SAMPLE_RATE });
  const outL = new Float32Array(PARITY_FRAMES);
  const outR = new Float32Array(PARITY_FRAMES);
  const bl = new Float32Array(PARITY_BLOCK);
  const br = new Float32Array(PARITY_BLOCK);
  for (let i = 0; i < PARITY_FRAMES; i += PARITY_BLOCK) {
    for (const change of c.changes) {
      if (change.at !== i) continue;
      if (change.params) k.setSettings(compileSynth(change.params));
      if (change.bend !== undefined) k.bend = change.bend;
      if (change.wheel !== undefined) k.modwheel = change.wheel;
    }
    const n = Math.min(PARITY_BLOCK, PARITY_FRAMES - i);
    k.process(bl, br, n, SYNTH_PARITY_START + i / PARITY_SAMPLE_RATE);
    outL.set(bl.subarray(0, n), i);
    outR.set(br.subarray(0, n), i);
  }
  return { outL, outR, state: k.takeState() };
}

const strided = (a: Float32Array) => a.filter((_, i) => i % PARITY_STRIDE === 0);

function rustSettings(s: CompiledSynth, indent: string): string {
  const i1 = indent + "    ";
  const i2 = i1 + "    ";
  const list = (items: string[]) => `[\n${items.map((x) => `${i2}${x},`).join("\n")}\n${i1}]`;
  const routes: string[] = [];
  for (let i = 0; i < s.routes.length; i += 4) {
    routes.push(`Route { source: ${s.routes[i]}, dest: ${s.routes[i + 1]}, amount: ${rustF64(s.routes[i + 2])}, bipolar: ${s.routes[i + 3] === 1} }`);
  }
  const env = (e: CompiledSynth["envs"][number]) =>
    `EnvSettings { delay: ${rustF64(e.delay)}, attack: ${rustF64(e.attack)}, hold: ${rustF64(e.hold)}, decay: ${rustF64(e.decay)}, ` +
    `sustain: ${rustF64(e.sustain)}, release: ${rustF64(e.release)}, attack_curve: ${rustF64(e.attackCurve)}, ` +
    `decay_curve: ${rustF64(e.decayCurve)}, release_curve: ${rustF64(e.releaseCurve)} }`;
  const lfo = (l: CompiledSynth["lfos"][number]) =>
    `LfoSettings { shape: ${l.shape}, rate: ${rustF64(l.rate)}, sync: ${l.sync}, beats: ${rustF64(l.beats)}, mode: ${l.mode}, ` +
    `phase: ${rustF64(l.phase)}, fade: ${rustF64(l.fade)} }`;
  return [
    `SynthSettings {`,
    `${i1}base: [${s.base.map(rustF64).join(", ")}],`,
    `${i1}routes: [Route::NONE; MAX_ROUTES],`,
    `${i1}route_count: 0,`,
    `${i1}osc: ${list(
      s.osc.map((o) => `OscSettings { on: ${o.on}, warp: ${o.warp}, unison: ${o.unison}, dest: ${o.dest}, phase: ${rustF64(o.phase)}, random_phase: ${rustF64(o.randomPhase)} }`)
    )},`,
    `${i1}sub: SubSettings { on: ${s.sub.on}, shape: ${s.sub.shape}, octave: ${rustF64(s.sub.octave)}, dest: ${s.sub.dest} },`,
    `${i1}noise: NoiseSettings { on: ${s.noise.on}, pink: ${s.noise.pink}, dest: ${s.noise.dest} },`,
    `${i1}filters: ${list(s.filters.map((f) => `FilterSettings { on: ${f.on}, kind: ${f.type}, keytrack: ${rustF64(f.keytrack)} }`))},`,
    `${i1}serial: ${s.serial},`,
    `${i1}envs: ${list(s.envs.map(env))},`,
    `${i1}lfos: ${list(s.lfos.map(lfo))},`,
    `${i1}macros: [${s.macros.map(rustF64).join(", ")}],`,
    `${i1}voice: VoiceSettings { mode: ${s.voice.mode}, polyphony: ${s.voice.polyphony}, glide: ${rustF64(s.voice.glide)}, ` +
      `bend_range: ${rustF64(s.voice.bendRange)}, velocity: ${rustF64(s.voice.velocity)} },`,
    `${indent}}`,
    `${indent}.with_routes(&[${routes.join(", ")}])`,
  ].join("\n");
}

function rustEvent(e: SynthParityEvent): string {
  const kind =
    e.type === "on"
      ? `SynthEventKind::On { note: ${e.note}, vel: ${rustF64(e.vel ?? 0)} }`
      : e.type === "off"
        ? `SynthEventKind::Off { note: ${e.note} }`
        : e.type === "allOff"
          ? "SynthEventKind::AllOff"
          : "SynthEventKind::Panic";
  return `Ev { at: ${e.at}, kind: ${kind} }`;
}

const rustOption = (x: string | undefined) => (x === undefined ? "None" : `Some(${x})`);

function rustChange(c: SynthParityChange): string {
  return [
    `            Change {`,
    `                at: ${c.at},`,
    `                settings: ${rustOption(c.params && rustSettings(compileSynth(c.params), "                "))},`,
    `                bend: ${rustOption(c.bend === undefined ? undefined : rustF64(c.bend))},`,
    `                wheel: ${rustOption(c.wheel === undefined ? undefined : rustF64(c.wheel))},`,
    `            },`,
  ].join("\n");
}

/** The fixture: the Rust file (cases, settings, notes) and the data (each
 * case's every PARITY_STRIDE-th output sample, left then right, and its
 * kernel's state at the end: voices, peaks, whether there's a newest
 * voice, its modulated knobs and envelopes, and the LFOs). */
export function synthParityFixture(): { rust: string; data: FixtureData } {
  const sig = paritySignal();
  const wavetables = tables(sig);
  const data = new FixtureData();
  const cases = SYNTH_PARITY_CASES.map((c) => {
    const r = renderCase(c, wavetables);
    data.f32(strided(r.outL));
    data.f32(strided(r.outR));
    const s = r.state;
    data.f64([
      s.voices,
      s.peak[0],
      s.peak[1],
      s.mod ? 1 : 0,
      ...(s.mod ?? DEST_SPECS.map(() => 0)),
      ...(s.env ?? [0, 0, 0].map(() => [0, 0])).flat(),
      ...s.lfo.flat(),
    ]);
    return [
      `    Case {`,
      `        name: ${JSON.stringify(c.name)},`,
      `        settings: ${rustSettings(compileSynth(c.params), "        ")},`,
      `        tables: [${c.tables.join(", ")}],`,
      `        bpm: ${rustF64(c.bpm)},`,
      `        bend: ${rustF64(c.bend)},`,
      `        wheel: ${rustF64(c.wheel)},`,
      `        events: &[${c.events.map(rustEvent).join(", ")}],`,
      c.changes.length ? [`        changes: &[`, ...c.changes.map(rustChange), `        ],`].join("\n") : `        changes: &[],`,
      `    },`,
    ].join("\n");
  });
  const rust = [
    "// @generated by src/instruments/synth/synthParity.test.ts from the",
    "// JavaScript kernel (synthKernel.ts). Don't edit it: to remake it,",
    "// run UPDATE_ENGINE_FIXTURES=1 npx vitest run --project unit synthParity",
    "",
    `const SAMPLE_RATE: f64 = ${rustF64(PARITY_SAMPLE_RATE)};`,
    `const FRAMES: usize = ${PARITY_FRAMES};`,
    `const BLOCK: usize = ${PARITY_BLOCK};`,
    `const STRIDE: usize = ${PARITY_STRIDE};`,
    `const START: f64 = ${rustF64(SYNTH_PARITY_START)};`,
    `const SIGNAL_HASH: u32 = ${rustHex(fnv1a([sig.inL, sig.inR, sig.keyL, sig.keyR]))};`,
    "// The JavaScript kernel's constants, which the port has its own copies of.",
    `const JS_STEP: usize = ${SYNTH_STEP};`,
    `const JS_DESTS: &[(f64, f64, bool)] = &[${DEST_SPECS.map((d) => `(${rustF64(d.min)}, ${rustF64(d.max)}, ${d.scale === "log"})`).join(", ")}];`,
    `const JS_MIP_HARMONICS: &[f64] = &[${MIP_HARMONICS.map(rustF64).join(", ")}];`,
    `const JS_MIP_SIZES: &[usize] = &[${MIP_SIZES.join(", ")}];`,
    `const TABLE_FRAMES: [usize; 3] = [${SYNTH_TABLE_FRAMES.join(", ")}];`,
    "const CASES: &[Case] = &[",
    ...cases,
    "];",
    "",
  ].join("\n");
  return { rust, data };
}
