import * as Tone from "tone";
import { GATE_KERNEL_SOURCE, type GateKernelSettings } from "./gateModel";
import { keySettingsFromParams } from "../sidechain/sidechainModel";
import { loadWorklet } from "../../engine/workletLoader";

// The Noise Gate effect: runs gateModel.ts's kernel in an AudioWorklet
// (sample-accurate, no added latency) and reports levels for the plugin
// window's history graph. Its second input is the sidechain.

const PROCESSOR_NAME = "dawn-noise-gate-v1";
const METER_INTERVAL = 1024;

const PROCESSOR_CODE = `
${GATE_KERNEL_SOURCE}
class DawnNoiseGate extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.kernel = new NoiseGateKernel(sampleRate);
    // Initial settings arrive with the node, so even an offline render
    // (WAV export) uses them from its very first sample.
    if (options && options.processorOptions) this.kernel.set(options.processorOptions);
    this.alive = true;
    this.peak = 0;
    this.minGain = 1;
    this.count = 0;
    this.port.onmessage = (e) => {
      if (e.data === "dispose") this.alive = false;
      else this.kernel.set(e.data);
    };
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const key = inputs[1] || [];
    const output = outputs[0];
    const n = output[0].length;
    const r = this.kernel.process(input[0] || null, input[1] || null, output[0], output[1] || null, n, key[0] || null, key[1] || null);
    if (r.peakIn > this.peak) this.peak = r.peakIn;
    if (r.minGain < this.minGain) this.minGain = r.minGain;
    this.count += n;
    if (this.count >= ${METER_INTERVAL}) {
      this.port.postMessage({ input: this.peak, gain: this.minGain, open: this.kernel.open });
      this.peak = 0;
      this.minGain = 1;
      this.count = 0;
    }
    return this.alive;
  }
}
registerProcessor("${PROCESSOR_NAME}", DawnNoiseGate);
`;

/** One meter reading, ~every 20 ms: the peak of what the gate listens to
 * (its input, or the sidechain) and the gate's gain (both dB), and whether
 * it's open. */
export interface GateReading {
  inputDb: number;
  gainDb: number;
  open: boolean;
}

/** Readings kept for the window's scrolling graph (~5 s at 48 kHz). */
const HISTORY = 240;

export function gateSettingsFromParams(params: Record<string, number>, external = false): GateKernelSettings {
  return {
    ...keySettingsFromParams(params, external),
    thresholdDb: params.threshold,
    attack: params.attack,
    hold: params.hold,
    release: params.release,
    rangeDb: params.range,
  };
}

export class NoiseGate extends Tone.ToneAudioNode {
  readonly name = "NoiseGate";
  readonly input = new Tone.Gain();
  readonly output = new Tone.Gain();
  /** Where the engine plugs a sidechain source in. */
  readonly sidechainInput = new Tone.Gain();
  private worklet: AudioWorkletNode | null = null;
  private params: Record<string, number>;
  private external = false;
  private pending = false;
  private readings: GateReading[] = [];
  private readingAt = 0;
  private isDisposed = false;

  constructor(params: Record<string, number>) {
    super();
    this.params = { ...params };
    loadWorklet(this.context, PROCESSOR_NAME, PROCESSOR_CODE).then(() => {
      if (this.isDisposed) return;
      const node = this.context.createAudioWorkletNode(PROCESSOR_NAME, {
        numberOfInputs: 2,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
        processorOptions: gateSettingsFromParams(this.params, this.external),
      });
      node.port.onmessage = (e: MessageEvent<{ input: number; gain: number; open: boolean }>) => {
        this.readings.push({ inputDb: Tone.gainToDb(e.data.input), gainDb: Tone.gainToDb(e.data.gain), open: e.data.open });
        if (this.readings.length > HISTORY) this.readings.shift();
        this.readingAt = performance.now();
      };
      this.worklet = node;
      this.input.connect(node);
      Tone.connect(this.sidechainInput, node, 0, 1);
      Tone.connect(node, this.output);
    });
  }

  private sync(): void {
    if (this.pending || !this.worklet) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      this.worklet?.port.postMessage(gateSettingsFromParams(this.params, this.external));
    });
  }

  setParam(key: string, value: number): void {
    this.params[key] = value;
    this.sync();
  }

  /** Detect from the sidechain input (true) or the gate's own input. */
  setSidechainActive(on: boolean): void {
    if (on === this.external) return;
    this.external = on;
    this.sync();
  }

  /** Recent readings, oldest first - empty once audio stops arriving (e.g.
   * bypassed), so the graph doesn't freeze on stale data. */
  get history(): GateReading[] {
    if (performance.now() - this.readingAt > 300) this.readings = [];
    return this.readings;
  }

  dispose(): this {
    super.dispose();
    this.isDisposed = true;
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.port.postMessage("dispose");
      this.worklet.disconnect();
    }
    this.sidechainInput.dispose();
    this.input.dispose();
    this.output.dispose();
    return this;
  }
}
