import * as Tone from "tone";
import { COMPRESSOR_SOURCE, compressorSettingsFromParams } from "./compressorModel";
import { loadWorklet } from "../../lib/workletLoader";

// The Compressor effect: compressorModel.ts's kernel in an AudioWorklet (no
// added latency). Its second input is the sidechain; the engine connects a
// track's key signal to `sidechainInput` (see sidechainRouting.ts).

const PROCESSOR_NAME = "dawn-compressor-v1";
const METER_INTERVAL = 512;

const PROCESSOR_CODE = `
${COMPRESSOR_SOURCE}
class DawnCompressor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.kernel = new CompressorKernel(sampleRate);
    this.kernel.set(options.processorOptions);
    this.count = 0;
    this.alive = true;
    this.port.onmessage = (e) => {
      if (e.data === "dispose") this.alive = false;
      else this.kernel.set(e.data);
    };
  }
  process(inputs, outputs) {
    const input = inputs[0] || [];
    const key = inputs[1] || [];
    const out = outputs[0];
    const n = out[0].length;
    this.kernel.process(input[0] || null, input[1] || null, key[0] || null, key[1] || null, out[0], out[1] || null, n);
    this.count += n;
    if (this.count >= ${METER_INTERVAL}) {
      this.count = 0;
      this.port.postMessage(this.kernel.takeMeters());
    }
    return this.alive;
  }
}
registerProcessor("${PROCESSOR_NAME}", DawnCompressor);
`;

/** Level meters fall back at this rate (dB/s) between peaks. */
const FALL_DB_PER_S = 30;

export interface CompressorMeterReading {
  input: number;
  gainReduction: number;
  output: number;
  /** The key signal the detector hears (after the sidechain gain/filters). */
  key: number;
}

const SILENT: CompressorMeterReading = { input: -Infinity, gainReduction: 0, output: -Infinity, key: -Infinity };

export class CompressorChain extends Tone.ToneAudioNode {
  readonly name = "CompressorChain";
  readonly input = new Tone.Gain();
  readonly output = new Tone.Gain();
  /** Where the engine plugs a sidechain source in. */
  readonly sidechainInput = new Tone.Gain();
  private worklet: AudioWorkletNode | null = null;
  private params: Record<string, number>;
  private external = false;
  private pending = false;
  private reading: CompressorMeterReading = SILENT;
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
        processorOptions: compressorSettingsFromParams(this.params, this.external),
      });
      node.port.onmessage = (e: MessageEvent<{ input: number; output: number; key: number; gainReduction: number }>) => {
        const now = performance.now();
        const fall = ((now - this.readingAt) / 1000) * FALL_DB_PER_S;
        const prev = now - this.readingAt > 300 ? SILENT : this.reading;
        const level = (v: number, last: number) => Math.max(Tone.gainToDb(v), last - fall);
        this.reading = {
          input: level(e.data.input, prev.input),
          output: level(e.data.output, prev.output),
          key: level(e.data.key, prev.key),
          gainReduction: Math.min(e.data.gainReduction, prev.gainReduction + fall),
        };
        this.readingAt = now;
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
      this.worklet?.port.postMessage(compressorSettingsFromParams(this.params, this.external));
    });
  }

  setParam(key: string, value: number): void {
    this.params[key] = value;
    this.sync();
  }

  /** Detect from the sidechain input (true) or the effect's own input. */
  setSidechainActive(on: boolean): void {
    if (on === this.external) return;
    this.external = on;
    this.sync();
  }

  /** Levels in dB (gain reduction <= 0) - silent once audio stops
   * arriving (e.g. bypassed). */
  get meters(): CompressorMeterReading {
    return performance.now() - this.readingAt > 300 ? SILENT : this.reading;
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
