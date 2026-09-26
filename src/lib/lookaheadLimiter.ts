import * as Tone from "tone";

// A true brick-wall limiter. The native DynamicsCompressorNode can't be one:
// its level detector is smoothed, so fast transients get through several dB
// over the threshold no matter the attack setting (and it adds its own hidden
// makeup gain - see nativeCompressorMakeup.ts). Hard-clipping those overshoots
// instead is what made the earlier version audibly "rip" the sound.
//
// This runs as an AudioWorklet. The audio is delayed by LOOKAHEAD seconds;
// for each sample the gain needed to keep it under the ceiling is held
// (sliding minimum) across the lookahead window, released slowly, then
// box-averaged over that same window - so the gain has already ramped
// smoothly down by the time the peak reaches the output, and the ceiling is
// never exceeded. No waveform clipping, just smooth gain changes.

const PROCESSOR_NAME = "dawn-lookahead-limiter";
const LOOKAHEAD = 0.005;
const RELEASE = 0.1;

const PROCESSOR_CODE = `
class DawnLookaheadLimiter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "ceiling", defaultValue: 1, minValue: 0.00001, maxValue: 1, automationRate: "k-rate" }];
  }

  constructor() {
    super();
    const size = Math.max(2, Math.round(sampleRate * ${LOOKAHEAD}) + 1);
    this.size = size;
    this.delayL = new Float32Array(size);
    this.delayR = new Float32Array(size);
    this.box = new Float64Array(size).fill(1);
    this.boxSum = size;
    this.dqVal = new Float64Array(size);
    this.dqIdx = new Float64Array(size);
    this.dqHead = 0;
    this.dqLen = 0;
    this.pos = 0;
    this.n = 0;
    this.env = 1;
    this.releaseCoef = 1 - Math.exp(-1 / (${RELEASE} * sampleRate));
    this.alive = true;
    this.port.onmessage = (e) => {
      if (e.data === "dispose") this.alive = false;
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0] || [];
    const output = outputs[0];
    const outL = output[0];
    const outR = output[1];
    const inL = input[0];
    const inR = input[1] || input[0];
    const ceiling = parameters.ceiling[0];
    const size = this.size;

    for (let i = 0; i < outL.length; i++) {
      const xl = inL ? inL[i] : 0;
      const xr = inR ? inR[i] : 0;
      const peak = Math.max(Math.abs(xl), Math.abs(xr));
      const required = peak > ceiling ? ceiling / peak : 1;

      while (this.dqLen > 0) {
        const tail = (this.dqHead + this.dqLen - 1) % size;
        if (this.dqVal[tail] >= required) this.dqLen--;
        else break;
      }
      const slot = (this.dqHead + this.dqLen) % size;
      this.dqVal[slot] = required;
      this.dqIdx[slot] = this.n;
      this.dqLen++;
      while (this.dqIdx[this.dqHead] <= this.n - size) {
        this.dqHead = (this.dqHead + 1) % size;
        this.dqLen--;
      }
      const held = this.dqVal[this.dqHead];

      this.env = held < this.env ? held : this.env + (held - this.env) * this.releaseCoef;

      const p = this.pos;
      this.boxSum += this.env - this.box[p];
      this.box[p] = this.env;
      const gain = this.boxSum / size;

      this.delayL[p] = xl;
      this.delayR[p] = xr;
      const read = (p + 1) % size;
      outL[i] = this.delayL[read] * gain;
      if (outR) outR[i] = this.delayR[read] * gain;

      this.pos = read;
      this.n++;
      if (read === 0) {
        let s = 0;
        for (let k = 0; k < size; k++) s += this.box[k];
        this.boxSum = s;
      }
    }
    return this.alive;
  }
}
registerProcessor("${PROCESSOR_NAME}", DawnLookaheadLimiter);
`;

let moduleUrl: string | null = null;
const loaded = new WeakMap<object, Promise<void>>();

/** Loads the limiter's worklet module into `context` (once per context).
 * An offline render must await this before rendering, so every limiter
 * created in it is actually in the graph. */
export function loadLimiterWorklet(context: Tone.BaseContext): Promise<void> {
  const raw = context.rawContext;
  let promise = loaded.get(raw);
  if (!promise) {
    moduleUrl ??= URL.createObjectURL(new Blob([PROCESSOR_CODE], { type: "application/javascript" }));
    promise = raw.audioWorklet!.addModule(moduleUrl);
    loaded.set(raw, promise);
  }
  return promise;
}

/** Silent until its worklet module has loaded (a few ms, once per audio
 * context) rather than passing audio through unlimited in the meantime. */
export class LookaheadLimiter extends Tone.ToneAudioNode {
  readonly name = "LookaheadLimiter";
  readonly input = new Tone.Gain();
  readonly output = new Tone.Gain();
  private worklet: AudioWorkletNode | null = null;
  private ceilingDb: number;
  private isDisposed = false;

  constructor(ceilingDb: number) {
    super();
    this.ceilingDb = ceilingDb;
    loadLimiterWorklet(this.context).then(() => {
      if (this.isDisposed) return;
      const node = this.context.createAudioWorkletNode(PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
        parameterData: { ceiling: Tone.dbToGain(this.ceilingDb) },
      });
      this.worklet = node;
      this.input.connect(node);
      Tone.connect(node, this.output);
    });
  }

  setCeiling(db: number): void {
    this.ceilingDb = db;
    const param = this.worklet?.parameters.get("ceiling");
    if (param) param.value = Tone.dbToGain(db);
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
