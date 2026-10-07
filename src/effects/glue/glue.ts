import * as Tone from "tone";
import { GLUE_OS_LATENCY, GLUE_SOURCE, glueSettingsFromParams } from "./glueModel";
import { loadWorklet } from "../../engine/workletLoader";

// The Glue Compressor effect: glueModel.ts's kernel in an AudioWorklet.
// Its second input is the sidechain (see sidechainRouting.ts).

const PROCESSOR_NAME = "dawn-glue-v1";
const METER_INTERVAL = 512;

const PROCESSOR_CODE = `
${GLUE_SOURCE}
class DawnGlue extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.kernel = new GlueKernel(sampleRate);
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
registerProcessor("${PROCESSOR_NAME}", DawnGlue);
`;

export interface GlueMeterReading {
  /** dB of gain reduction, >= 0. */
  gainReduction: number;
  /** Output peak, dBFS. */
  output: number;
  /** The Clip LED: off, soft clipping (yellow) or over 0 dB (red). Held
   * briefly so a single peak is visible. */
  clip: "off" | "soft" | "over";
}

const SILENT: GlueMeterReading = { gainReduction: 0, output: -Infinity, clip: "off" };
const CLIP_HOLD_MS = 350;

export class GlueChain extends Tone.ToneAudioNode {
  readonly name = "GlueChain";
  readonly input = new Tone.Gain();
  readonly output = new Tone.Gain();
  /** Where the engine plugs a sidechain source in. */
  readonly sidechainInput = new Tone.Gain();
  private worklet: AudioWorkletNode | null = null;
  private params: Record<string, number>;
  private external = false;
  private pending = false;
  private reading: GlueMeterReading = SILENT;
  private readingAt = 0;
  private overAt = -Infinity;
  private softAt = -Infinity;
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
        processorOptions: glueSettingsFromParams(this.params, this.external),
      });
      node.port.onmessage = (e: MessageEvent<{ gainReduction: number; output: number; clipping: boolean }>) => {
        const now = performance.now();
        if (e.data.output > 1) this.overAt = now;
        if (e.data.clipping) this.softAt = now;
        this.reading = {
          gainReduction: e.data.gainReduction,
          output: Tone.gainToDb(e.data.output),
          clip: now - this.overAt < CLIP_HOLD_MS ? "over" : now - this.softAt < CLIP_HOLD_MS ? "soft" : "off",
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
      this.worklet?.port.postMessage(glueSettingsFromParams(this.params, this.external));
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

  /** Seconds oversampling delays the audio. */
  get latency(): number {
    return (this.params.oversample ?? 0) >= 0.5 ? GLUE_OS_LATENCY / this.context.sampleRate : 0;
  }

  /** The latest meters - at rest once audio stops arriving. */
  get meters(): GlueMeterReading {
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
