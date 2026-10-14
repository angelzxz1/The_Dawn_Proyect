import * as Tone from "tone";
import { EQ_SOURCE, eqBandsFromParams } from "./paramEqModel";
import { loadWorklet } from "../../engine/workletLoader";

// The Parametric EQ effect: paramEqModel.ts's kernel in an AudioWorklet
// (no added latency), with spectrum analyzers tapping the signal before
// and after it for the plugin window, and a band-solo (audition) mode.

const PROCESSOR_NAME = "dawn-param-eq-v1";

const PROCESSOR_CODE = `
${EQ_SOURCE}
class DawnParamEq extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.kernel = new ParamEqKernel(sampleRate);
    // Initial settings arrive with the node, so an offline render (WAV
    // export) is equalized from its first sample.
    if (options && options.processorOptions) this.kernel.set(options.processorOptions);
    this.alive = true;
    this.port.onmessage = (e) => {
      if (e.data === "dispose") this.alive = false;
      else this.kernel.set(e.data);
    };
  }
  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0];
    this.kernel.process(input[0] || null, input[1] || null, output[0], output[1] || null, output[0].length);
    return this.alive;
  }
}
registerProcessor("${PROCESSOR_NAME}", DawnParamEq);
`;

const ANALYZER_SIZE = 8192;

export class ParamEqChain extends Tone.ToneAudioNode {
  readonly name = "ParamEqChain";
  readonly input = new Tone.Gain();
  readonly output = new Tone.Gain();
  private readonly pre = new Tone.Analyser({ type: "fft", size: ANALYZER_SIZE, smoothing: 0.75 });
  private readonly post = new Tone.Analyser({ type: "fft", size: ANALYZER_SIZE, smoothing: 0.75 });
  private worklet: AudioWorkletNode | null = null;
  private params: Record<string, number>;
  private solo = -1;
  private pending = false;
  private isDisposed = false;

  constructor(params: Record<string, number>) {
    super();
    this.params = { ...params };
    // The post analyzer taps the worklet itself: the output node's
    // connections are cleared whenever the effect chain is rewired.
    this.input.connect(this.pre);
    loadWorklet(this.context, PROCESSOR_NAME, PROCESSOR_CODE).then(() => {
      if (this.isDisposed) return;
      const node = this.context.createAudioWorkletNode(PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
        processorOptions: this.state(),
      });
      this.worklet = node;
      this.input.connect(node);
      Tone.connect(node, this.output);
      Tone.connect(node, this.post);
    });
  }

  private state() {
    return { bands: eqBandsFromParams(this.params), outputDb: this.params.output ?? 0, solo: this.solo };
  }

  /** Coalesces a burst of param changes (a band drag sends several per
   * frame) into one message to the audio thread. */
  private sync(): void {
    if (this.pending || !this.worklet) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      this.worklet?.port.postMessage(this.state());
    });
  }

  setParam(key: string, value: number): void {
    if (key === "scale" || key === "analyzer") return; // view-only
    this.params[key] = value;
    this.sync();
  }

  /** Auditions one band (index, 0-based) - only its region passes - or
   * turns that off with -1. Not saved; it's a listening aid. */
  setSolo(band: number): void {
    this.solo = band;
    this.sync();
  }

  /** The latest spectrum (dB per FFT bin, 0 Hz to Nyquist) before or after
   * the EQ, for the window's analyzer. */
  spectrum(which: "pre" | "post"): Float32Array {
    return (which === "pre" ? this.pre : this.post).getValue() as Float32Array;
  }

  dispose(): this {
    super.dispose();
    this.isDisposed = true;
    if (this.worklet) {
      this.worklet.port.postMessage("dispose");
      this.worklet.disconnect();
    }
    this.pre.dispose();
    this.post.dispose();
    this.input.dispose();
    this.output.dispose();
    return this;
  }
}
