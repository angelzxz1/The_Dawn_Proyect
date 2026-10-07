import * as Tone from "tone";
import { chorusDelayRange, chorusWaveformFromParam } from "./chorusModel";

const CHORUS_FEEDBACK_ON = 0.001;

/** A stereo chorus: each side is a short delay whose time an LFO sweeps
 * (Spread = the right LFO's phase offset from the left), with optional
 * feedback and an equal-power dry/wet blend. Built from plain nodes so the
 * LFO phases and sweep are exactly what the Chorus window's graph draws
 * (see chorusModel.ts), and so the feedback loop only exists while Feedback
 * is above zero - the Web Audio spec allows a browser to clamp any delay
 * that sits inside a loop to at least one 128-sample block (~2.9ms), which
 * would cut off the short end of the sweep. */
export class ChorusChain extends Tone.ToneAudioNode {
  readonly name = "ChorusChain";
  readonly input = new Tone.Gain();
  readonly output = new Tone.Gain();
  private readonly split = new Tone.Split(2);
  private readonly merge = new Tone.Merge();
  private readonly delayL = new Tone.Delay({ delayTime: 0.0035, maxDelay: 0.05 });
  private readonly delayR = new Tone.Delay({ delayTime: 0.0035, maxDelay: 0.05 });
  private readonly feedbackL = new Tone.Gain(0);
  private readonly feedbackR = new Tone.Gain(0);
  private readonly lfoL: Tone.LFO;
  private readonly lfoR: Tone.LFO;
  private readonly dryGain = new Tone.Gain();
  private readonly wetGain = new Tone.Gain();
  private delayMs: number;
  private depth: number;
  private feedbackLooped = false;

  constructor(params: Record<string, number>) {
    super();
    this.delayMs = params.delayTime;
    this.depth = params.depth;
    const type = chorusWaveformFromParam(params.waveform);
    this.lfoL = new Tone.LFO({ frequency: params.frequency, type, phase: 0 });
    this.lfoR = new Tone.LFO({ frequency: params.frequency, type, phase: params.spread });

    this.input.channelCount = 2;
    this.input.channelCountMode = "explicit";
    this.input.connect(this.dryGain);
    this.dryGain.connect(this.output);
    this.input.connect(this.split);
    this.split.connect(this.delayL, 0);
    this.split.connect(this.delayR, 1);
    this.delayL.connect(this.merge, 0, 0);
    this.delayR.connect(this.merge, 0, 1);
    this.merge.connect(this.wetGain);
    this.wetGain.connect(this.output);

    this.lfoL.connect(this.delayL.delayTime);
    this.lfoR.connect(this.delayR.delayTime);
    const now = this.now();
    this.lfoL.start(now);
    this.lfoR.start(now);

    this.applySweep();
    this.setFeedback(params.feedback);
    this.setWet(params.wet);
  }

  private applySweep(): void {
    const [min, max] = chorusDelayRange(this.delayMs, this.depth);
    for (const lfo of [this.lfoL, this.lfoR]) {
      lfo.min = min / 1000;
      lfo.max = max / 1000;
    }
  }

  setRate(hz: number): void {
    this.lfoL.frequency.value = hz;
    this.lfoR.frequency.value = hz;
  }

  setDelay(ms: number): void {
    this.delayMs = ms;
    this.applySweep();
  }

  setDepth(amount: number): void {
    this.depth = amount;
    this.applySweep();
  }

  setSpread(degrees: number): void {
    this.lfoR.phase = degrees;
  }

  setWaveform(v: number): void {
    const type = chorusWaveformFromParam(v);
    this.lfoL.type = type;
    this.lfoR.type = type;
  }

  setFeedback(amount: number): void {
    this.feedbackL.gain.value = amount;
    this.feedbackR.gain.value = amount;
    const looped = amount > CHORUS_FEEDBACK_ON;
    if (looped === this.feedbackLooped) return;
    this.feedbackLooped = looped;
    if (looped) {
      this.delayL.connect(this.feedbackL);
      this.feedbackL.connect(this.delayL);
      this.delayR.connect(this.feedbackR);
      this.feedbackR.connect(this.delayR);
    } else {
      this.delayL.disconnect(this.feedbackL);
      this.feedbackL.disconnect();
      this.delayR.disconnect(this.feedbackR);
      this.feedbackR.disconnect();
    }
  }

  /** Equal-power, like Tone.Chorus's own crossfade, so saved choruses keep
   * their balance. */
  setWet(mix: number): void {
    this.dryGain.gain.value = Math.cos((mix * Math.PI) / 2);
    this.wetGain.gain.value = Math.sin((mix * Math.PI) / 2);
  }

  dispose(): this {
    super.dispose();
    this.lfoL.dispose();
    this.lfoR.dispose();
    this.split.dispose();
    this.merge.dispose();
    this.delayL.dispose();
    this.delayR.dispose();
    this.feedbackL.dispose();
    this.feedbackR.dispose();
    this.dryGain.dispose();
    this.wetGain.dispose();
    this.input.dispose();
    this.output.dispose();
    return this;
  }
}
