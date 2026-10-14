import * as Tone from "tone";

/** A stereo delay with independent left/right times, a highpass+lowpass
 * filter pair shaping each channel's repeats (toggleable), ping-pong
 * cross-feedback, and a freeze mode - none of which Tone.FeedbackDelay (a
 * single mono tap) can do. Built from plain Tone nodes rather than a single
 * Tone effect class. */
export class DelayChain extends Tone.ToneAudioNode {
  readonly name = "DelayChain";
  readonly input: Tone.Gain;
  readonly output: Tone.Gain;
  private readonly inputGateL: Tone.Gain;
  private readonly inputGateR: Tone.Gain;
  private readonly delayL: Tone.Delay;
  private readonly delayR: Tone.Delay;
  private readonly lowCutL: Tone.Filter;
  private readonly highCutL: Tone.Filter;
  private readonly lowCutR: Tone.Filter;
  private readonly highCutR: Tone.Filter;
  private readonly feedbackGainL: Tone.Gain;
  private readonly feedbackGainR: Tone.Gain;
  private readonly merge: Tone.Merge;
  private readonly dryGain: Tone.Gain;
  private readonly wetGain: Tone.Gain;
  private filterOn: boolean;
  private pingPong: boolean;
  private frozen: boolean;
  private feedbackAmount: number;

  constructor(params: Record<string, number>) {
    super();
    this.input = new Tone.Gain();
    this.output = new Tone.Gain();
    this.inputGateL = new Tone.Gain(1);
    this.inputGateR = new Tone.Gain(1);
    this.delayL = new Tone.Delay({ delayTime: params.delayTimeL, maxDelay: 2 });
    this.delayR = new Tone.Delay({ delayTime: params.delayTimeR, maxDelay: 2 });
    this.lowCutL = new Tone.Filter({ type: "highpass", frequency: params.lowCut, Q: 0.7 });
    this.highCutL = new Tone.Filter({ type: "lowpass", frequency: params.highCut, Q: 0.7 });
    this.lowCutR = new Tone.Filter({ type: "highpass", frequency: params.lowCut, Q: 0.7 });
    this.highCutR = new Tone.Filter({ type: "lowpass", frequency: params.highCut, Q: 0.7 });
    this.feedbackAmount = params.feedback;
    this.feedbackGainL = new Tone.Gain(params.feedback);
    this.feedbackGainR = new Tone.Gain(params.feedback);
    this.merge = new Tone.Merge();
    this.dryGain = new Tone.Gain(1 - params.wet);
    this.wetGain = new Tone.Gain(params.wet);
    this.filterOn = params.filterOn >= 0.5;
    this.pingPong = params.pingPong >= 0.5;
    this.frozen = params.freeze >= 0.5;

    this.input.connect(this.inputGateL);
    this.input.connect(this.inputGateR);
    this.input.connect(this.dryGain);
    this.inputGateL.connect(this.delayL);
    this.inputGateR.connect(this.delayR);
    this.dryGain.connect(this.output);
    this.merge.connect(this.wetGain);
    this.wetGain.connect(this.output);

    this.rewireFeedback();
    if (this.frozen) this.applyFreeze();
  }

  /** Rebuilds the delay -> (optional filter) -> [feedback tap, wet tap]
   * routing from scratch - called whenever Filter or Ping-Pong is toggled,
   * since both change where those connections actually go. */
  private rewireFeedback(): void {
    this.delayL.disconnect();
    this.delayR.disconnect();
    this.lowCutL.disconnect();
    this.highCutL.disconnect();
    this.lowCutR.disconnect();
    this.highCutR.disconnect();
    this.feedbackGainL.disconnect();
    this.feedbackGainR.disconnect();

    if (this.filterOn) {
      this.delayL.connect(this.lowCutL);
      this.lowCutL.connect(this.highCutL);
      this.delayR.connect(this.lowCutR);
      this.lowCutR.connect(this.highCutR);
    }
    const tapL: Tone.ToneAudioNode = this.filterOn ? this.highCutL : this.delayL;
    const tapR: Tone.ToneAudioNode = this.filterOn ? this.highCutR : this.delayR;

    tapL.connect(this.feedbackGainL);
    tapL.connect(this.merge, 0, 0);
    tapR.connect(this.feedbackGainR);
    tapR.connect(this.merge, 0, 1);

    if (this.pingPong) {
      // Each channel's repeats feed the *other* delay line, so a single
      // input bounces L/R/L/R instead of each side echoing independently.
      this.feedbackGainL.connect(this.delayR);
      this.feedbackGainR.connect(this.delayL);
    } else {
      this.feedbackGainL.connect(this.delayL);
      this.feedbackGainR.connect(this.delayR);
    }
  }

  /** Freeze locks the feedback loop near unity gain and stops new input
   * from entering it, so whatever's already repeating sustains indefinitely
   * instead of decaying or being overwritten. */
  private applyFreeze(): void {
    this.inputGateL.gain.value = 0;
    this.inputGateR.gain.value = 0;
    this.feedbackGainL.gain.value = 0.995;
    this.feedbackGainR.gain.value = 0.995;
  }

  private releaseFreeze(): void {
    this.inputGateL.gain.value = 1;
    this.inputGateR.gain.value = 1;
    this.feedbackGainL.gain.value = this.feedbackAmount;
    this.feedbackGainR.gain.value = this.feedbackAmount;
  }

  setDelayTimeL(seconds: number): void {
    this.delayL.delayTime.value = seconds;
  }

  setDelayTimeR(seconds: number): void {
    this.delayR.delayTime.value = seconds;
  }

  setFeedback(amount: number): void {
    this.feedbackAmount = amount;
    if (!this.frozen) {
      this.feedbackGainL.gain.value = amount;
      this.feedbackGainR.gain.value = amount;
    }
  }

  setLowCut(frequency: number): void {
    this.lowCutL.frequency.value = frequency;
    this.lowCutR.frequency.value = frequency;
  }

  setHighCut(frequency: number): void {
    this.highCutL.frequency.value = frequency;
    this.highCutR.frequency.value = frequency;
  }

  setWet(mix: number): void {
    this.dryGain.gain.value = 1 - mix;
    this.wetGain.gain.value = mix;
  }

  setFilterOn(on: boolean): void {
    if (this.filterOn === on) return;
    this.filterOn = on;
    this.rewireFeedback();
  }

  setPingPong(on: boolean): void {
    if (this.pingPong === on) return;
    this.pingPong = on;
    this.rewireFeedback();
  }

  setFreeze(on: boolean): void {
    if (this.frozen === on) return;
    this.frozen = on;
    if (on) this.applyFreeze();
    else this.releaseFreeze();
  }

  dispose(): this {
    super.dispose();
    this.inputGateL.dispose();
    this.inputGateR.dispose();
    this.delayL.dispose();
    this.delayR.dispose();
    this.lowCutL.dispose();
    this.highCutL.dispose();
    this.lowCutR.dispose();
    this.highCutR.dispose();
    this.feedbackGainL.dispose();
    this.feedbackGainR.dispose();
    this.merge.dispose();
    this.dryGain.dispose();
    this.wetGain.dispose();
    this.input.dispose();
    this.output.dispose();
    return this;
  }
}
