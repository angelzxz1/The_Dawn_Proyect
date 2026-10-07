import * as Tone from "tone";
import { AMP_LATENCY, AMP_SOURCE } from "./ampKernel";
import { ampSettingsFromParams } from "./ampModel";
import { loadWorklet } from "../../lib/workletLoader";

// The Furnace amp effect: ampKernel.ts in an AudioWorklet. Mono like a
// real amp (a stereo input is summed); the output feeds both sides.

const PROCESSOR_NAME = "dawn-amp-v1";

const PROCESSOR_CODE = `
${AMP_SOURCE}
class DawnAmp extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.kernel = new AmpKernel(sampleRate);
    this.kernel.set(options.processorOptions);
    this.alive = true;
    this.port.onmessage = (e) => {
      if (e.data === "dispose") this.alive = false;
      else this.kernel.set(e.data);
    };
  }
  process(inputs, outputs) {
    const input = inputs[0] || [];
    const out = outputs[0][0];
    this.kernel.process(input[0] || null, out, out.length);
    return this.alive;
  }
}
registerProcessor("${PROCESSOR_NAME}", DawnAmp);
`;

export class AmpSimChain extends Tone.ToneAudioNode {
  readonly name = "AmpSimChain";
  readonly input = new Tone.Gain();
  readonly output = new Tone.Gain();
  private worklet: AudioWorkletNode | null = null;
  private params: Record<string, number>;
  private pending = false;
  private isDisposed = false;

  constructor(params: Record<string, number>) {
    super();
    this.params = { ...params };
    loadWorklet(this.context, PROCESSOR_NAME, PROCESSOR_CODE).then(() => {
      if (this.isDisposed) return;
      const node = this.context.createAudioWorkletNode(PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
        processorOptions: ampSettingsFromParams(this.params),
      });
      this.worklet = node;
      this.input.connect(node);
      Tone.connect(node, this.output);
    });
  }

  setParam(key: string, value: number): void {
    this.params[key] = value;
    if (this.pending || !this.worklet) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      this.worklet?.port.postMessage(ampSettingsFromParams(this.params));
    });
  }

  /** Seconds the oversampling filters delay the audio. */
  get latency(): number {
    return AMP_LATENCY / this.context.sampleRate;
  }

  dispose(): this {
    super.dispose();
    this.isDisposed = true;
    if (this.worklet) {
      this.worklet.port.postMessage("dispose");
      this.worklet.disconnect();
    }
    this.input.dispose();
    this.output.dispose();
    return this;
  }
}
