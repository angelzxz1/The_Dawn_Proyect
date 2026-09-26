import * as Tone from "tone";
import { loadWorklet } from "./workletLoader";

// A delay-line pitch shifter running as an AudioWorklet. Tone.PitchShift
// drives its delay lines with a scaled oscillator LFO whose speed formula
// doesn't produce the requested ratio - measured, it landed 20-86 cents off
// (a -12 shift came out nearly a semitone sharp). Here the delay ramps are
// computed exactly:
//
// Two read taps sweep across a window of recent input, half a window apart.
// Reading a delay that shrinks at rate (r - 1) plays the audio back r times
// faster (up); one that grows at (1 - r) plays it slower (down). Each tap
// jumps back when its sweep ends, so each is faded with a Hann window that
// is silent at the jump, and the two windows (half a cycle apart) always sum
// to 1. Reads use 4-point Hermite interpolation. Feedback returns the output
// into the delay line, so each pass is shifted again.

const PROCESSOR_NAME = "dawn-pitch-shifter-v1";
const BUFFER_SIZE = 65536; // ~1.4s at 44.1kHz, far above the longest window

const PROCESSOR_CODE = `
class DawnPitchShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "ratio", defaultValue: 1, minValue: 0.1, maxValue: 8, automationRate: "k-rate" },
      { name: "window", defaultValue: 0.1, minValue: 0.005, maxValue: 0.5, automationRate: "k-rate" },
      { name: "feedback", defaultValue: 0, minValue: 0, maxValue: 0.95, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this.mask = ${BUFFER_SIZE} - 1;
    this.buffers = [new Float32Array(${BUFFER_SIZE}), new Float32Array(${BUFFER_SIZE})];
    this.last = [0, 0];
    this.write = 0;
    this.phase = 0;
    this.alive = true;
    this.port.onmessage = (e) => {
      if (e.data === "dispose") this.alive = false;
    };
  }

  read(buf, pos) {
    const m = this.mask;
    const i = Math.floor(pos);
    const f = pos - i;
    const y0 = buf[(i - 1) & m];
    const y1 = buf[i & m];
    const y2 = buf[(i + 1) & m];
    const y3 = buf[(i + 2) & m];
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * f + c2) * f + c1) * f + y1;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0] || [];
    const output = outputs[0];
    const ratio = parameters.ratio[0];
    const windowSamples = parameters.window[0] * sampleRate;
    const feedback = parameters.feedback[0];
    const up = ratio >= 1;
    const step = Math.abs(1 - ratio) / windowSamples;
    const frames = output[0].length;

    for (let i = 0; i < frames; i++) {
      const pA = this.phase;
      const pB = pA < 0.5 ? pA + 0.5 : pA - 0.5;
      const dA = (up ? 1 - pA : pA) * windowSamples;
      const dB = (up ? 1 - pB : pB) * windowSamples;
      const sA = Math.sin(Math.PI * pA);
      const sB = Math.sin(Math.PI * pB);
      const gA = sA * sA;
      const gB = sB * sB;
      for (let ch = 0; ch < 2; ch++) {
        const src = input[ch] || input[0];
        const buf = this.buffers[ch];
        buf[this.write] = (src ? src[i] : 0) + feedback * this.last[ch];
        // 2 samples of headroom so the Hermite read never reaches unwritten
        // samples.
        const y = gA * this.read(buf, this.write - dA - 2) + gB * this.read(buf, this.write - dB - 2);
        this.last[ch] = y;
        if (output[ch]) output[ch][i] = y;
      }
      this.write = (this.write + 1) & this.mask;
      this.phase += step;
      if (this.phase >= 1) this.phase -= 1;
    }
    return this.alive;
  }
}
registerProcessor("${PROCESSOR_NAME}", DawnPitchShifter);
`;

export interface PitchShiftSettings {
  /** Semitones. */
  pitch: number;
  /** Cents, added to `pitch`. */
  fine: number;
  /** Seconds. */
  window: number;
  feedback: number;
  /** 0..1 dry/wet, equal-power (as Tone.PitchShift's crossfade was). */
  wet: number;
}

/** The shifted (wet) path is silent until its worklet module has loaded (a
 * few ms, once per audio context); the dry path passes straight through. */
export class PitchShifter extends Tone.ToneAudioNode {
  readonly name = "PitchShifter";
  readonly input = new Tone.Gain();
  readonly output = new Tone.Gain();
  private readonly dryGain = new Tone.Gain();
  private readonly wetGain = new Tone.Gain();
  private worklet: AudioWorkletNode | null = null;
  private settings: PitchShiftSettings;
  private isDisposed = false;

  constructor(settings: PitchShiftSettings) {
    super();
    this.settings = { ...settings };
    this.input.connect(this.dryGain);
    this.dryGain.connect(this.output);
    this.wetGain.connect(this.output);
    this.setWet(settings.wet);
    loadWorklet(this.context, PROCESSOR_NAME, PROCESSOR_CODE).then(() => {
      if (this.isDisposed) return;
      const node = this.context.createAudioWorkletNode(PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
        parameterData: {
          ratio: this.ratio(),
          window: this.settings.window,
          feedback: this.settings.feedback,
        },
      });
      this.worklet = node;
      this.input.connect(node);
      Tone.connect(node, this.wetGain);
    });
  }

  private setParam(name: string, value: number): void {
    const param = this.worklet?.parameters.get(name);
    if (param) param.value = value;
  }

  private ratio(): number {
    return Math.pow(2, (this.settings.pitch + this.settings.fine / 100) / 12);
  }

  setPitch(semitones: number): void {
    this.settings.pitch = semitones;
    this.setParam("ratio", this.ratio());
  }

  setFine(cents: number): void {
    this.settings.fine = cents;
    this.setParam("ratio", this.ratio());
  }

  setWindow(seconds: number): void {
    this.settings.window = seconds;
    this.setParam("window", seconds);
  }

  setFeedback(amount: number): void {
    this.settings.feedback = amount;
    this.setParam("feedback", amount);
  }

  setWet(mix: number): void {
    this.settings.wet = mix;
    this.dryGain.gain.value = Math.cos((mix * Math.PI) / 2);
    this.wetGain.gain.value = Math.sin((mix * Math.PI) / 2);
  }

  dispose(): this {
    super.dispose();
    this.isDisposed = true;
    if (this.worklet) {
      this.worklet.port.postMessage("dispose");
      this.worklet.disconnect();
    }
    this.dryGain.dispose();
    this.wetGain.dispose();
    this.input.dispose();
    this.output.dispose();
    return this;
  }
}
