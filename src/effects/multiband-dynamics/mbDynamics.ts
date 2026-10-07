import * as Tone from "tone";
import { MBD_SOURCE, mbdSettingsFromParams, type MbdBand } from "./mbDynamicsModel";
import { loadWorklet } from "../../lib/workletLoader";

// The Multiband Dynamics effect: mbDynamicsModel.ts's kernel in an
// AudioWorklet (no added latency). Its second input is the sidechain.

const PROCESSOR_NAME = "dawn-mb-dynamics-v1";
const METER_INTERVAL = 1024;

const PROCESSOR_CODE = `
${MBD_SOURCE}
class DawnMbDynamics extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.kernel = new MbdKernel(sampleRate);
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
registerProcessor("${PROCESSOR_NAME}", DawnMbDynamics);
`;

/** Per band that exists: its peak level going in (after Input) and coming
 * out, in dB. */
export type MbdMeters = Partial<Record<MbdBand, { input: number; output: number }>>;

export class MbDynamicsChain extends Tone.ToneAudioNode {
  readonly name = "MbDynamicsChain";
  readonly input = new Tone.Gain();
  readonly output = new Tone.Gain();
  /** Where the engine plugs a sidechain source in. */
  readonly sidechainInput = new Tone.Gain();
  private worklet: AudioWorkletNode | null = null;
  private params: Record<string, number>;
  private external = false;
  private pending = false;
  private reading: MbdMeters = {};
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
        processorOptions: mbdSettingsFromParams(this.params, this.external),
      });
      node.port.onmessage = (e: MessageEvent<Record<string, { input: number; output: number }>>) => {
        const out: MbdMeters = {};
        Object.entries(e.data).forEach(([band, m]) => {
          out[band as MbdBand] = { input: Tone.gainToDb(m.input), output: Tone.gainToDb(m.output) };
        });
        this.reading = out;
        this.readingAt = performance.now();
      };
      this.worklet = node;
      this.input.connect(node);
      Tone.connect(this.sidechainInput, node, 0, 1);
      Tone.connect(node, this.output);
    });
  }

  /** Coalesces a burst of param changes (an all-bands drag) into one
   * message. */
  private sync(): void {
    if (this.pending || !this.worklet) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      this.worklet?.port.postMessage(mbdSettingsFromParams(this.params, this.external));
    });
  }

  setParam(key: string, value: number): void {
    if (key === "view") return; // display-only
    this.params[key] = value;
    this.sync();
  }

  /** Detect from the sidechain input (true) or the effect's own input. */
  setSidechainActive(on: boolean): void {
    if (on === this.external) return;
    this.external = on;
    this.sync();
  }

  /** The latest meters - empty once audio stops arriving. */
  get meters(): MbdMeters {
    return performance.now() - this.readingAt > 300 ? {} : this.reading;
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
