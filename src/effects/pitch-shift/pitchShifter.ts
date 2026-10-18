import * as Tone from "tone";
import { loadWorklet } from "../../engine/workletLoader";
import { PITCH_SHIFTER_NAME, PITCH_SHIFTER_SOURCE } from "./pitchShiftKernel";

// The Pitch Shift's audio node: the shifter (pitchShiftKernel.ts) as an
// AudioWorklet, beside a dry path waiting as long, blended equal-power.

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
  /** The dry signal waits as long as the shifted one takes, so a Dry/Wet
   * blend is a harmony in time rather than a slapback. */
  private readonly dryDelay = new Tone.Delay(0, 0.5);
  private worklet: AudioWorkletNode | null = null;
  private settings: PitchShiftSettings;
  private isDisposed = false;

  constructor(settings: PitchShiftSettings) {
    super();
    this.settings = { ...settings };
    this.dryDelay.delayTime.value = this.latency;
    this.input.chain(this.dryDelay, this.dryGain);
    this.dryGain.connect(this.output);
    this.wetGain.connect(this.output);
    this.setWet(settings.wet);
    loadWorklet(this.context, PITCH_SHIFTER_NAME, PITCH_SHIFTER_SOURCE).then(() => {
      if (this.isDisposed) return;
      const node = this.context.createAudioWorkletNode(PITCH_SHIFTER_NAME, {
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
    this.dryDelay.delayTime.value = this.latency;
  }

  /** Seconds the shifted signal lags the input: the read taps sit half a
   * window (plus the interpolator's 2 samples) behind on average. */
  get latency(): number {
    const sr = this.context.sampleRate;
    return (this.settings.window * sr) / 2 / sr + 2 / sr;
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
    this.dryDelay.dispose();
    this.dryGain.dispose();
    this.wetGain.dispose();
    this.input.dispose();
    this.output.dispose();
    return this;
  }
}
