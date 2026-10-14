import * as Tone from "tone";
import { loadWorklet } from "../../engine/workletLoader";

// A true brick-wall limiter. The native DynamicsCompressorNode can't be one:
// its level detector is smoothed, so fast transients get through several dB
// over the threshold no matter the attack setting (and it adds its own hidden
// makeup gain). Hard-clipping those overshoots
// instead is what made an earlier version audibly "rip" the sound.
//
// This runs as an AudioWorklet. Input gain is applied first, then (optionally)
// a soft clipper. The audio is then delayed by LOOKAHEAD seconds; for each
// sample the gain needed to keep it under the ceiling is held (sliding
// minimum) across the lookahead window, released over the Release time, then
// box-averaged over that same window - so the gain has already ramped
// smoothly down by the time the peak reaches the output, and the ceiling is
// never exceeded.
//
// Soft Clip rounds peaks off with a tanh curve before the limiter sees them:
// linear up to 6dB under the ceiling, then easing toward +3dB over it. It
// trades a little saturation for transients the limiter no longer has to
// duck as hard; the limiter still guarantees the ceiling afterwards.
//
// Every METER_INTERVAL samples the processor posts the peak input (after
// gain), peak output, and deepest gain reduction for the plugin's meters.

const PROCESSOR_NAME = "dawn-lookahead-limiter-v2";
const LOOKAHEAD = 0.005;
const METER_INTERVAL = 2048;

const PROCESSOR_CODE = `
const SQRT2 = Math.SQRT2;

function softClip(x, ceiling) {
  const a = Math.abs(x);
  const knee = 0.5 * ceiling;
  if (a <= knee) return x;
  const span = SQRT2 * ceiling - knee;
  const y = knee + span * Math.tanh((a - knee) / span);
  return x < 0 ? -y : y;
}

class DawnLookaheadLimiter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "ceiling", defaultValue: 1, minValue: 0.00001, maxValue: 1, automationRate: "k-rate" },
      { name: "gain", defaultValue: 1, minValue: 0, maxValue: 64, automationRate: "k-rate" },
      { name: "release", defaultValue: 0.1, minValue: 0.001, maxValue: 5, automationRate: "k-rate" },
      { name: "softClip", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
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
    this.release = -1;
    this.releaseCoef = 0;
    this.meterIn = 0;
    this.meterOut = 0;
    this.meterGain = 1;
    this.meterCount = 0;
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
    const drive = parameters.gain[0];
    const clip = parameters.softClip[0] >= 0.5;
    const release = parameters.release[0];
    if (release !== this.release) {
      this.release = release;
      this.releaseCoef = 1 - Math.exp(-1 / (release * sampleRate));
    }
    const size = this.size;

    for (let i = 0; i < outL.length; i++) {
      let xl = (inL ? inL[i] : 0) * drive;
      let xr = (inR ? inR[i] : 0) * drive;
      const inPeak = Math.max(Math.abs(xl), Math.abs(xr));
      if (inPeak > this.meterIn) this.meterIn = inPeak;
      if (clip) {
        xl = softClip(xl, ceiling);
        xr = softClip(xr, ceiling);
      }
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
      if (gain < this.meterGain) this.meterGain = gain;

      this.delayL[p] = xl;
      this.delayR[p] = xr;
      const read = (p + 1) % size;
      const yl = this.delayL[read] * gain;
      const yr = this.delayR[read] * gain;
      outL[i] = yl;
      if (outR) outR[i] = yr;
      const outPeak = Math.max(Math.abs(yl), Math.abs(yr));
      if (outPeak > this.meterOut) this.meterOut = outPeak;

      this.pos = read;
      this.n++;
      if (read === 0) {
        let s = 0;
        for (let k = 0; k < size; k++) s += this.box[k];
        this.boxSum = s;
      }
    }

    this.meterCount += outL.length;
    if (this.meterCount >= ${METER_INTERVAL}) {
      // Soft clip's own reduction at the loudest input sample, on top of the
      // limiter's deepest gain reduction in this interval.
      const clipped = clip && this.meterIn > 0 ? softClip(this.meterIn, ceiling) / this.meterIn : 1;
      this.port.postMessage({ input: this.meterIn, output: this.meterOut, reduction: this.meterGain * clipped });
      this.meterIn = 0;
      this.meterOut = 0;
      this.meterGain = 1;
      this.meterCount = 0;
    }
    return this.alive;
  }
}
registerProcessor("${PROCESSOR_NAME}", DawnLookaheadLimiter);
`;

function loadLimiterWorklet(context: Tone.BaseContext): Promise<void> {
  return loadWorklet(context, PROCESSOR_NAME, PROCESSOR_CODE);
}

export interface LimiterSettings {
  ceilingDb: number;
  gainDb: number;
  /** Seconds. */
  release: number;
  softClip: boolean;
}

/** Peak levels (dBFS) and gain reduction (dB, >= 0) over the most recent
 * meter interval. */
export interface LimiterLevels {
  inputDb: number;
  outputDb: number;
  reductionDb: number;
}

const SILENT: LimiterLevels = { inputDb: -Infinity, outputDb: -Infinity, reductionDb: 0 };

/** Silent until its worklet module has loaded (a few ms, once per audio
 * context) rather than passing audio through unlimited in the meantime. */
export class LookaheadLimiter extends Tone.ToneAudioNode {
  readonly name = "LookaheadLimiter";
  readonly input = new Tone.Gain();
  readonly output = new Tone.Gain();
  private worklet: AudioWorkletNode | null = null;
  private settings: LimiterSettings;
  private levels: LimiterLevels = SILENT;
  private levelsAt = 0;
  private isDisposed = false;

  /** Seconds the lookahead delays the audio (for delay compensation). */
  get latency(): number {
    return Math.round(this.context.sampleRate * LOOKAHEAD) / this.context.sampleRate;
  }

  constructor(settings: Partial<LimiterSettings> & { ceilingDb: number }) {
    super();
    this.settings = { gainDb: 0, release: 0.1, softClip: false, ...settings };
    loadLimiterWorklet(this.context).then(() => {
      if (this.isDisposed) return;
      const s = this.settings;
      const node = this.context.createAudioWorkletNode(PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
        parameterData: {
          ceiling: Tone.dbToGain(s.ceilingDb),
          gain: Tone.dbToGain(s.gainDb),
          release: s.release,
          softClip: s.softClip ? 1 : 0,
        },
      });
      node.port.onmessage = (e: MessageEvent<{ input: number; output: number; reduction: number }>) => {
        this.levels = {
          inputDb: Tone.gainToDb(e.data.input),
          outputDb: Tone.gainToDb(e.data.output),
          reductionDb: Math.max(0, -Tone.gainToDb(e.data.reduction)),
        };
        this.levelsAt = performance.now();
      };
      this.worklet = node;
      this.input.connect(node);
      Tone.connect(node, this.output);
    });
  }

  private setParam(name: string, value: number): void {
    const param = this.worklet?.parameters.get(name);
    if (param) param.value = value;
  }

  setCeiling(db: number): void {
    this.settings.ceilingDb = db;
    this.setParam("ceiling", Tone.dbToGain(db));
  }

  setGain(db: number): void {
    this.settings.gainDb = db;
    this.setParam("gain", Tone.dbToGain(db));
  }

  setRelease(seconds: number): void {
    this.settings.release = seconds;
    this.setParam("release", seconds);
  }

  setSoftClip(on: boolean): void {
    this.settings.softClip = on;
    this.setParam("softClip", on ? 1 : 0);
  }

  /** Latest meter reading - reads as silent once the processor stops
   * reporting (e.g. the effect is bypassed and no longer receives audio). */
  get meterLevels(): LimiterLevels {
    return performance.now() - this.levelsAt > 250 ? SILENT : this.levels;
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
