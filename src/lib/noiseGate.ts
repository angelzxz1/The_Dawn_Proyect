import * as Tone from "tone";
import { GATE_KERNEL_SOURCE, type GateSettings } from "./gateModel";
import { loadWorklet } from "./workletLoader";

// The Noise Gate effect: runs gateModel.ts's kernel in an AudioWorklet
// (sample-accurate, no added latency) and reports levels for the plugin
// window's history graph.

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
    const output = outputs[0];
    const n = output[0].length;
    const r = this.kernel.process(input[0] || null, input[1] || null, output[0], output[1] || null, n);
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

/** One meter reading, ~every 20 ms: the input's peak and the gate's gain
 * (both dB), and whether it's open. */
export interface GateReading {
  inputDb: number;
  gainDb: number;
  open: boolean;
}

/** Readings kept for the window's scrolling graph (~5 s at 48 kHz). */
const HISTORY = 240;

export function gateSettingsFromParams(params: Record<string, number>): GateSettings {
  return {
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
  private worklet: AudioWorkletNode | null = null;
  private settings: GateSettings;
  private readings: GateReading[] = [];
  private readingAt = 0;
  private isDisposed = false;

  constructor(settings: GateSettings) {
    super();
    this.settings = settings;
    loadWorklet(this.context, PROCESSOR_NAME, PROCESSOR_CODE).then(() => {
      if (this.isDisposed) return;
      const node = this.context.createAudioWorkletNode(PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
        processorOptions: this.settings,
      });
      node.port.onmessage = (e: MessageEvent<{ input: number; gain: number; open: boolean }>) => {
        this.readings.push({ inputDb: Tone.gainToDb(e.data.input), gainDb: Tone.gainToDb(e.data.gain), open: e.data.open });
        if (this.readings.length > HISTORY) this.readings.shift();
        this.readingAt = performance.now();
      };
      this.worklet = node;
      this.input.connect(node);
      Tone.connect(node, this.output);
    });
  }

  configure(change: Partial<GateSettings>): void {
    this.settings = { ...this.settings, ...change };
    this.worklet?.port.postMessage(this.settings);
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
    this.input.dispose();
    this.output.dispose();
    return this;
  }
}
