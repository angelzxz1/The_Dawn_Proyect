import * as Tone from "tone";
import type { Instrument } from "../instrument";
import { DRUM_SOURCE } from "./drumKernel";
import { decodeEffectFileAudio } from "../../effects/effectFiles";
import { PAD_COUNT, compileDrumKit, padNote, type DrumKitParams } from "./drumParams";
import { loadWorklet } from "../../lib/workletLoader";

// The Drum Rack instrument: drumKernel.ts in an AudioWorklet. Hits are
// sent as timestamped events (so scheduled hits land on their sample);
// sample pads' files are decoded here and handed over.

const PROCESSOR_NAME = "dawn-drums-v1";
const MONITOR_INTERVAL = 1024;

const PROCESSOR_CODE = `
${DRUM_SOURCE}
class DawnDrums extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.k = new DawnDrumKernel(sampleRate);
    o.samples.forEach((s, i) => s && this.k.setSample(i, s));
    this.k.setSettings(o.settings);
    o.events.forEach((e) => this.k.addEvent(e));
    this.monitor = false;
    this.count = 0;
    this.alive = true;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.t === "ev") this.k.addEvent(m.e);
      else if (m.t === "set") this.k.setSettings(m.s);
      else if (m.t === "sample") this.k.setSample(m.pad, m.data);
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
registerProcessor("${PROCESSOR_NAME}", DawnDrums);
`;

type DrumEvent = { type: "on" | "panic"; note?: number; vel?: number; time: number };

/** What the Drum Rack window shows live. */
export interface DrumLiveState {
  /** A bit per pad hit since the last report. */
  hits: number;
  peak: number;
  voices: number;
}

/** A sample's channels at `sampleRate`, decoded once per file and rate. */
const decoded = new Map<string, Promise<Float32Array[] | null>>();
export function loadDrumSample(fileId: string, sampleRate: number): Promise<Float32Array[] | null> {
  const key = `${fileId}@${sampleRate}`;
  let p = decoded.get(key);
  if (!p) {
    p = decodeEffectFileAudio(fileId, sampleRate).then((buf) =>
      buf ? Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, c) => buf.getChannelData(c)) : null
    );
    decoded.set(key, p);
  }
  return p;
}

export class DrumRack implements Instrument {
  private output = new Tone.Gain(1);
  private node: AudioWorkletNode | null = null;
  private kit: DrumKitParams;
  private pending: DrumEvent[] = [];
  private samples: (Float32Array[] | null)[] = new Array(PAD_COUNT).fill(null);
  private sampleIds: (string | null)[] = new Array(PAD_COUNT).fill(null);
  private syncQueued = false;
  private disposed = false;
  private listener: ((s: DrumLiveState) => void) | null = null;
  /** Resolves once the worklet runs with every sample loaded. */
  readonly ready: Promise<void>;

  constructor(kit: DrumKitParams) {
    this.kit = kit;
    const context = this.output.context;
    this.ready = Promise.all([loadWorklet(context, PROCESSOR_NAME, PROCESSOR_CODE), this.loadSamples(kit)]).then(() => {
      if (this.disposed) return;
      const node = context.createAudioWorkletNode(PROCESSOR_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { samples: this.samples, settings: compileDrumKit(this.kit), events: this.pending },
      });
      this.pending = [];
      node.port.onmessage = (e: MessageEvent<DrumLiveState>) => this.listener?.(e.data);
      if (this.listener) node.port.postMessage({ t: "monitor", v: true });
      Tone.connect(node, this.output);
      this.node = node;
    });
  }

  /** Loads the pads' samples that changed. */
  private async loadSamples(kit: DrumKitParams): Promise<void> {
    const rate = this.output.context.sampleRate;
    await Promise.all(
      kit.pads.map(async (pad, i) => {
        const id = pad.sample?.id ?? null;
        if (id === this.sampleIds[i]) return;
        this.sampleIds[i] = id;
        const data = id ? await loadDrumSample(id, rate) : null;
        if (this.sampleIds[i] !== id) return;
        this.samples[i] = data;
        this.node?.port.postMessage({ t: "sample", pad: i, data });
      })
    );
  }

  setKit(kit: DrumKitParams): void {
    this.kit = kit;
    void this.loadSamples(kit);
    if (this.syncQueued) return;
    this.syncQueued = true;
    queueMicrotask(() => {
      this.syncQueued = false;
      this.node?.port.postMessage({ t: "set", s: compileDrumKit(this.kit) });
    });
  }

  setMonitor(listener: ((s: DrumLiveState) => void) | null): void {
    this.listener = listener;
    this.node?.port.postMessage({ t: "monitor", v: !!listener });
  }

  private send(e: DrumEvent): void {
    if (this.node) this.node.port.postMessage({ t: "ev", e });
    else this.pending.push(e);
  }

  private seconds(time?: Tone.Unit.Time): number {
    return time !== undefined ? Tone.Time(time).toSeconds() : Tone.immediate();
  }

  /** Plays a pad now (clicking it in the window). */
  audition(pad: number, velocity = 0.9): void {
    this.send({ type: "on", note: padNote(pad), vel: velocity, time: Tone.immediate() });
  }

  triggerAttack(note: string, time?: Tone.Unit.Time, velocity = 0.8): void {
    this.send({ type: "on", note: Tone.Frequency(note).toMidi(), vel: velocity, time: this.seconds(time) });
  }

  /** Hits ring out on their own. */
  triggerRelease(): void {}

  triggerAttackRelease(note: string, _duration: Tone.Unit.Time, time?: Tone.Unit.Time, velocity = 0.8): void {
    this.triggerAttack(note, time, velocity);
  }

  /** Tails keep ringing when playback stops, like a drum machine's. */
  releaseAll(): void {}

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
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.port.postMessage({ t: "dispose" });
      this.node.disconnect();
    }
    this.output.dispose();
  }
}
