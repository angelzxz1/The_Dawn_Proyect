import * as Tone from "tone";
import { MB_MAX_BANDS, MB_SOURCE, mbSettingsFromParams } from "./multibandModel";
import { loadWorklet } from "../../engine/workletLoader";

// The Multiband Compressor effect: multibandModel.ts's kernel in an
// AudioWorklet (no added latency). It reports each band's gain and level
// for the window's live curve and meters, and taps spectrum analyzers
// before and after itself. Its second input is the sidechain.

const PROCESSOR_NAME = "dawn-multiband-v1";
const METER_INTERVAL = 1024;

const PROCESSOR_CODE = `
${MB_SOURCE}
class DawnMultiband extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.kernel = new MultibandKernel(sampleRate);
    // Initial settings arrive with the node, so an offline render (WAV
    // export) is processed from its first sample.
    if (options && options.processorOptions) this.kernel.set(options.processorOptions);
    this.alive = true;
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
    const k = this.kernel;
    k.process(input[0] || null, input[1] || null, output[0], output[1] || null, n, key[0] || null, key[1] || null);
    this.count += n;
    if (this.count >= ${METER_INTERVAL}) {
      this.port.postMessage({ gain: Array.from(k.meterGain), level: Array.from(k.meterLevel) });
      k.meterGain.fill(0);
      k.meterLevel.fill(0);
      this.count = 0;
    }
    return this.alive;
  }
}
registerProcessor("${PROCESSOR_NAME}", DawnMultiband);
`;

const ANALYZER_SIZE = 8192;

/** The latest reading per band: its dynamic gain (dB, negative when it's
 * compressing) and its peak level (dB). */
export interface MultibandMeters {
  gainDb: number[];
  levelDb: number[];
}

const silent = (): MultibandMeters => ({ gainDb: Array(MB_MAX_BANDS).fill(0), levelDb: Array(MB_MAX_BANDS).fill(-Infinity) });

export class MultibandChain extends Tone.ToneAudioNode {
  readonly name = "MultibandChain";
  readonly input = new Tone.Gain();
  readonly output = new Tone.Gain();
  /** Where the engine plugs a sidechain source in. */
  readonly sidechainInput = new Tone.Gain();
  private readonly pre = new Tone.Analyser({ type: "fft", size: ANALYZER_SIZE, smoothing: 0.75 });
  private readonly post = new Tone.Analyser({ type: "fft", size: ANALYZER_SIZE, smoothing: 0.75 });
  private worklet: AudioWorkletNode | null = null;
  private params: Record<string, number>;
  private solo = -1;
  private external = false;
  private pending = false;
  private reading = silent();
  private readingAt = 0;
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
        numberOfInputs: 2,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
        processorOptions: mbSettingsFromParams(this.params, this.solo, this.external),
      });
      node.port.onmessage = (e: MessageEvent<{ gain: number[]; level: number[] }>) => {
        this.reading = { gainDb: e.data.gain, levelDb: e.data.level.map((v) => Tone.gainToDb(v)) };
        this.readingAt = performance.now();
      };
      this.worklet = node;
      this.input.connect(node);
      Tone.connect(this.sidechainInput, node, 0, 1);
      Tone.connect(node, this.output);
      Tone.connect(node, this.post);
    });
  }

  /** Coalesces a burst of param changes (a split sends dozens) into one
   * message to the audio thread. */
  private sync(): void {
    if (this.pending || !this.worklet) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      this.worklet?.port.postMessage(mbSettingsFromParams(this.params, this.solo, this.external));
    });
  }

  setParam(key: string, value: number): void {
    if (key === "scale" || key === "analyzer") return; // view-only
    this.params[key] = value;
    this.sync();
  }

  /** Detect from the sidechain input (true) or the effect's own input. */
  setSidechainActive(on: boolean): void {
    if (on === this.external) return;
    this.external = on;
    this.sync();
  }

  /** Hears one band (0-based) alone, or all with -1. Not saved. */
  setSolo(band: number): void {
    this.solo = band;
    this.sync();
  }

  /** The latest meter reading - flat once audio stops arriving (e.g.
   * bypassed), so the display doesn't freeze on stale data. */
  get meters(): MultibandMeters {
    if (performance.now() - this.readingAt > 300) this.reading = silent();
    return this.reading;
  }

  spectrum(which: "pre" | "post"): Float32Array {
    return (which === "pre" ? this.pre : this.post).getValue() as Float32Array;
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
    this.pre.dispose();
    this.post.dispose();
    this.input.dispose();
    this.output.dispose();
    return this;
  }
}
