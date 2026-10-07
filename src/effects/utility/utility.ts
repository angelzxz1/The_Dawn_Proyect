import * as Tone from "tone";
import { UTILITY_SOURCE, utilitySettingsFromParams } from "./utilityModel";
import { loadWorklet } from "../../lib/workletLoader";

// The Utility effect: utilityModel.ts's kernel in an AudioWorklet (no
// latency). It reports output meters, L/R correlation, and recent samples
// for the window's vectorscope.

const PROCESSOR_NAME = "dawn-utility-v1";
const METER_INTERVAL = 2048;
/** Vectorscope points kept: every 4th sample of the last ~40 ms. */
const SCOPE_POINTS = 512;

const PROCESSOR_CODE = `
${UTILITY_SOURCE}
class DawnUtility extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.kernel = new UtilityKernel(sampleRate);
    this.kernel.set(options.processorOptions);
    this.scope = new Float32Array(${SCOPE_POINTS * 2});
    this.scopeAt = 0;
    this.count = 0;
    this.alive = true;
    this.port.onmessage = (e) => {
      if (e.data === "dispose") this.alive = false;
      else this.kernel.set(e.data);
    };
  }
  process(inputs, outputs) {
    const input = inputs[0] || [];
    const out = outputs[0];
    const n = out[0].length;
    this.kernel.process(input[0] || null, input[1] || null, out[0], out[1] || null, n);
    for (let i = 0; i < n; i += 4) {
      this.scope[this.scopeAt * 2] = out[0][i];
      this.scope[this.scopeAt * 2 + 1] = out[1] ? out[1][i] : out[0][i];
      this.scopeAt = (this.scopeAt + 1) % ${SCOPE_POINTS};
    }
    this.count += n;
    if (this.count >= ${METER_INTERVAL}) {
      this.count = 0;
      const m = this.kernel.takeMeters();
      // Oldest point first.
      const points = new Float32Array(${SCOPE_POINTS * 2});
      points.set(this.scope.subarray(this.scopeAt * 2));
      points.set(this.scope.subarray(0, this.scopeAt * 2), (${SCOPE_POINTS} - this.scopeAt) * 2);
      this.port.postMessage({ peakL: m.peakL, peakR: m.peakR, correlation: m.correlation, points }, [points.buffer]);
    }
    return this.alive;
  }
}
registerProcessor("${PROCESSOR_NAME}", DawnUtility);
`;

export interface UtilityMeters {
  /** Output peaks, dBFS. */
  peakL: number;
  peakR: number;
  /** -1 (opposite) .. 0 (unrelated) .. 1 (mono). */
  correlation: number;
  /** Recent output samples as L, R pairs. */
  points: Float32Array;
}

export class UtilityChain extends Tone.ToneAudioNode {
  readonly name = "UtilityChain";
  readonly input = new Tone.Gain();
  readonly output = new Tone.Gain();
  private worklet: AudioWorkletNode | null = null;
  private params: Record<string, number>;
  private pending = false;
  private reading: UtilityMeters | null = null;
  private readingAt = 0;
  private isDisposed = false;

  constructor(params: Record<string, number>) {
    super();
    this.params = { ...params };
    loadWorklet(this.context, PROCESSOR_NAME, PROCESSOR_CODE).then(() => {
      if (this.isDisposed) return;
      const node = this.context.createAudioWorkletNode(PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
        processorOptions: utilitySettingsFromParams(this.params),
      });
      node.port.onmessage = (e: MessageEvent<{ peakL: number; peakR: number; correlation: number; points: Float32Array }>) => {
        this.reading = {
          peakL: Tone.gainToDb(e.data.peakL),
          peakR: Tone.gainToDb(e.data.peakR),
          correlation: e.data.correlation,
          points: e.data.points,
        };
        this.readingAt = performance.now();
      };
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
      this.worklet?.port.postMessage(utilitySettingsFromParams(this.params));
    });
  }

  /** The latest meters - null once audio stops arriving. */
  get meters(): UtilityMeters | null {
    return performance.now() - this.readingAt > 300 ? null : this.reading;
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
