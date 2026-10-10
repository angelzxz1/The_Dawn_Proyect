import * as Tone from "tone";
import type { Instrument } from "../instrument";
import { decodeEffectFileAudio } from "../../effects/effectFiles";
import { SYNTH_SOURCE } from "./synthKernel";
import { compileSynth, type SynthOscParams, type SynthParams } from "./synthParams";
import { factoryWavetable, subWavetable, wavetableFromAudio, type WavetableData } from "./wavetableModel";
import { loadWorklet } from "../../engine/workletLoader";

// The synth instrument ("Daybreak"): synthKernel.ts in an AudioWorklet.
// Notes go to the worklet as timestamped events, so scheduled notes start
// on their exact sample; wavetables are built here and handed over.

const PROCESSOR_NAME = "dawn-synth-v1";
const MONITOR_INTERVAL = 1024;

const PROCESSOR_CODE = `
${SYNTH_SOURCE}
class DawnSynth extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.k = new DawnSynthKernel(sampleRate);
    this.k.bpm = o.bpm;
    this.k.bend = o.bend;
    this.k.modwheel = o.modwheel;
    o.tables.forEach((t, i) => t && this.k.setTable(i, t));
    this.k.setSettings(o.settings);
    o.events.forEach((e) => this.k.addEvent(e));
    this.monitor = false;
    this.count = 0;
    this.alive = true;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.t === "ev") this.k.addEvent(m.e);
      else if (m.t === "set") this.k.setSettings(m.s);
      else if (m.t === "table") this.k.setTable(m.slot, m.data);
      else if (m.t === "bend") this.k.bend = m.v;
      else if (m.t === "wheel") this.k.modwheel = m.v;
      else if (m.t === "bpm") this.k.bpm = m.v;
      else if (m.t === "monitor") this.monitor = m.v;
      else if (m.t === "dispose") this.alive = false;
    };
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] || new Float32Array(L.length);
    this.k.process(L, R, L.length, currentTime);
    if (this.monitor) {
      this.count += L.length;
      if (this.count >= ${MONITOR_INTERVAL}) {
        this.count = 0;
        this.port.postMessage(this.k.takeState());
      }
    }
    return this.alive;
  }
}
registerProcessor("${PROCESSOR_NAME}", DawnSynth);
`;

type SynthEvent = { type: "on" | "off" | "allOff" | "panic"; note?: number; vel?: number; time: number };

/** What the synth window shows live (see the kernel's takeState). */
export interface SynthLiveState {
  voices: number;
  /** The newest voice's knob positions after modulation (0..1, DEST_SPECS order). */
  mod: number[] | null;
  /** Per envelope: [stage, level]. */
  env: [number, number][] | null;
  /** Per LFO: [phase, value]. */
  lfo: [number, number][];
  peak: [number, number];
  scope: Float32Array;
}

let tempo = 120;
const instances = new Set<SynthInstrument>();

/** Keeps tempo-synced LFOs in time. */
export function setSynthTempo(bpm: number): void {
  tempo = bpm;
  instances.forEach((s) => s.post({ t: "bpm", v: bpm }));
}

const userTables = new Map<string, Promise<WavetableData | null>>();

/** An imported wavetable, decoded and cut into cycles once per file. */
export function loadUserWavetable(fileId: string): Promise<WavetableData | null> {
  let promise = userTables.get(fileId);
  if (!promise) {
    promise = decodeEffectFileAudio(fileId, 48000).then((buffer) => (buffer ? wavetableFromAudio(buffer.getChannelData(0)) : null));
    userTables.set(fileId, promise);
  }
  return promise;
}

function tableKey(osc: SynthOscParams): string {
  return osc.userTable ? `user:${osc.userTable.id}` : osc.table;
}

async function tableFor(osc: SynthOscParams): Promise<WavetableData> {
  if (osc.userTable) {
    const user = await loadUserWavetable(osc.userTable.id);
    if (user) return user;
  }
  return factoryWavetable(osc.table);
}

function toMidi(note: string): number {
  return Tone.Frequency(note).toMidi();
}

export class SynthInstrument implements Instrument {
  private output = new Tone.Gain(1);
  private node: AudioWorkletNode | null = null;
  private params: SynthParams;
  private pending: SynthEvent[] = [];
  private tables: (WavetableData | null)[] = [null, null, subWavetable()];
  private keys = ["", ""];
  private bend = 0;
  private wheel = 0;
  private syncQueued = false;
  private disposed = false;
  private listener: ((s: SynthLiveState) => void) | null = null;
  /** Resolves once the worklet is running (with its wavetables). */
  readonly ready: Promise<void>;

  constructor(params: SynthParams) {
    this.params = params;
    instances.add(this);
    const context = this.output.context;
    this.ready = Promise.all([loadWorklet(context, PROCESSOR_NAME, PROCESSOR_CODE), this.loadTables(params)]).then(() => {
      if (this.disposed) return;
      const node = context.createAudioWorkletNode(PROCESSOR_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          bpm: tempo,
          bend: this.bend,
          modwheel: this.wheel,
          tables: this.tables,
          settings: compileSynth(this.params),
          events: this.pending,
        },
      });
      this.pending = [];
      node.port.onmessage = (e: MessageEvent<SynthLiveState>) => this.listener?.(e.data);
      if (this.listener) node.port.postMessage({ t: "monitor", v: true });
      Tone.connect(node, this.output);
      this.node = node;
    });
  }

  /** Loads the oscillators' wavetables that changed; true if any did. */
  private async loadTables(params: SynthParams): Promise<boolean> {
    const oscs = [params.osc1, params.osc2];
    const changed = oscs.map((o, i) => tableKey(o) !== this.keys[i]);
    if (!changed.some(Boolean)) return false;
    oscs.forEach((o, i) => changed[i] && (this.keys[i] = tableKey(o)));
    const loaded = await Promise.all(oscs.map((o, i) => (changed[i] ? tableFor(o) : null)));
    loaded.forEach((t, i) => {
      if (!t || this.keys[i] !== tableKey(oscs[i])) return;
      this.tables[i] = t;
      this.node?.port.postMessage({ t: "table", slot: i, data: t });
    });
    return true;
  }

  /** @internal */
  post(message: Record<string, unknown>): void {
    this.node?.port.postMessage(message);
  }

  private send(e: SynthEvent): void {
    if (this.node) this.node.port.postMessage({ t: "ev", e });
    else this.pending.push(e);
  }

  setParams(params: SynthParams): void {
    this.params = params;
    void this.loadTables(params);
    if (this.syncQueued) return;
    this.syncQueued = true;
    queueMicrotask(() => {
      this.syncQueued = false;
      this.node?.port.postMessage({ t: "set", s: compileSynth(this.params) });
    });
  }

  /** Live state for the window, ~45 times a second while someone listens. */
  setMonitor(listener: ((s: SynthLiveState) => void) | null): void {
    this.listener = listener;
    this.node?.port.postMessage({ t: "monitor", v: !!listener });
  }

  setDetune(cents: number): void {
    // The engine's bend is ±2 semitones at full; the synth scales it by its own range.
    this.bend = Math.max(-1, Math.min(1, cents / 200));
    this.node?.port.postMessage({ t: "bend", v: this.bend });
  }

  setModWheel(amount: number): void {
    this.wheel = Math.max(0, Math.min(1, amount));
    this.node?.port.postMessage({ t: "wheel", v: this.wheel });
  }

  private seconds(time?: Tone.Unit.Time): number {
    return time !== undefined ? Tone.Time(time).toSeconds() : Tone.immediate();
  }

  triggerAttack(note: string, time?: Tone.Unit.Time, velocity = 0.8): void {
    this.send({ type: "on", note: toMidi(note), vel: velocity, time: this.seconds(time) });
  }

  triggerRelease(note: string, time?: Tone.Unit.Time): void {
    this.send({ type: "off", note: toMidi(note), time: this.seconds(time) });
  }

  triggerAttackRelease(note: string, duration: Tone.Unit.Time, time?: Tone.Unit.Time, velocity = 0.8): void {
    const start = this.seconds(time);
    const midi = toMidi(note);
    this.send({ type: "on", note: midi, vel: velocity, time: start });
    this.send({ type: "off", note: midi, time: start + Tone.Time(duration).toSeconds() });
  }

  releaseAll(time?: Tone.Unit.Time): void {
    this.send({ type: "allOff", time: this.seconds(time) });
  }

  connect(node: Tone.InputNode): this {
    this.output.connect(node);
    return this;
  }

  disconnect(): this {
    this.output.disconnect();
    return this;
  }

  dispose(): void {
    this.disposed = true;
    instances.delete(this);
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.port.postMessage({ t: "dispose" });
      this.node.disconnect();
    }
    this.output.dispose();
  }
}
