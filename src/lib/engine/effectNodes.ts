// The effects' audio nodes - the ones built here from Tone nodes (delay,
// reverb, filter, chorus, IR loader) and the factory for every effect type,
// with how each parameter is applied. Shared by the live engine and the
// export, so both build identical chains.

import * as Tone from "tone";
import { type EffectType, defaultParams } from "../effects";
import { CompressorChain } from "../compressor";
import { GlueChain } from "../glue";
import { MbDynamicsChain } from "../mbDynamics";
import { LookaheadLimiter } from "../lookaheadLimiter";
import { PitchShifter } from "../pitchShifter";
import { convolverChannels, effectiveHighCut, effectiveLowCut, irNormalizationGain } from "../irModel";
import { NamAmpChain } from "../namAmp";
import { AmpSimChain } from "../ampSim";
import { NoiseGate } from "../noiseGate";
import { ParamEqChain } from "../paramEq";
import { MultibandChain } from "../multiband";
import { UtilityChain } from "../utility";
import { TunerChain } from "../tuner";
import { type ImpulseParams, renderImpulse, reverbModeFromParam } from "../reverbModel";
import { chorusDelayRange, chorusWaveformFromParam } from "../chorusModel";
import { SaturatorChain } from "../saturator";
import {
  type FilterMode,
  LFO_MAX_OCTAVES,
  designFilter,
  filterModeFromParam,
  legacyFilterTypeToMode,
  slopeIndexFromParam,
} from "../filterModel";

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

const REVERB_REBUILD_DEBOUNCE_MS = 40;

interface ReverbStage {
  convolver: ConvolverNode;
  /** Whether pre-delay still feeds it (only the newest stage is fed). */
  fed: boolean;
}

/** A convolution reverb whose impulse response is generated from its knobs
 * (see reverbModel.ts) rather than Tone.Reverb's fixed noise burst. The wet
 * path is input -> low cut -> high cut -> pre-delay -> convolver. Changing a
 * knob that reshapes the impulse (Decay, Damping, Early, Width, Mode)
 * renders a new one into a fresh ConvolverNode that takes over all new
 * input, while the old one stops being fed and rings out its existing tail
 * naturally - so a knob change never cuts off (or clicks) the reverb that's
 * already sounding. Native ConvolverNodes are used directly because
 * Tone.Convolver silently resets `normalize` to true whenever its buffer is
 * replaced. */
export class ReverbChain extends Tone.ToneAudioNode {
  readonly name = "ReverbChain";
  readonly input = new Tone.Gain();
  readonly output = new Tone.Gain();
  private readonly lowCut: Tone.Filter;
  private readonly highCut: Tone.Filter;
  private readonly preDelay: Tone.Delay;
  private readonly dryGain: Tone.Gain;
  private readonly wetGain: Tone.Gain;
  private current: ReverbStage | null = null;
  private readonly ringingOut = new Set<ReverbStage>();
  private impulse: ImpulseParams;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private isDisposed = false;

  constructor(params: Record<string, number>) {
    super();
    this.lowCut = new Tone.Filter({ type: "highpass", frequency: params.lowCut, Q: 0.7 });
    this.highCut = new Tone.Filter({ type: "lowpass", frequency: params.highCut, Q: 0.7 });
    this.preDelay = new Tone.Delay({ delayTime: params.preDelay, maxDelay: 0.3 });
    this.dryGain = new Tone.Gain(1 - params.wet);
    this.wetGain = new Tone.Gain(params.wet);
    this.impulse = {
      decay: params.decay,
      damping: params.damping,
      early: params.early,
      width: params.width,
      mode: reverbModeFromParam(params.mode),
    };

    this.input.connect(this.dryGain);
    this.dryGain.connect(this.output);
    this.input.chain(this.lowCut, this.highCut, this.preDelay);
    this.wetGain.connect(this.output);
    this.swapImpulse(false);
  }

  private swapImpulse(letOldRingOut: boolean): void {
    const sampleRate = this.context.sampleRate;
    const [left, right] = renderImpulse(sampleRate, this.impulse);
    const buffer = this.context.createBuffer(2, left.length, sampleRate);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    const convolver = this.context.createConvolver();
    convolver.normalize = false; // renderImpulse already normalizes
    convolver.buffer = buffer;
    this.preDelay.connect(convolver);
    Tone.connect(convolver, this.wetGain);

    const previous = this.current;
    this.current = { convolver, fed: true };
    if (!previous) return;
    this.unfeed(previous);
    if (!letOldRingOut) {
      this.release(previous);
      return;
    }
    this.ringingOut.add(previous);
    const tailMs = (previous.convolver.buffer?.duration ?? 0) * 1000 + 200;
    setTimeout(() => {
      if (!this.ringingOut.delete(previous)) return;
      this.release(previous);
    }, tailMs);
  }

  private unfeed(stage: ReverbStage): void {
    if (!stage.fed) return;
    stage.fed = false;
    this.preDelay.disconnect(stage.convolver);
  }

  private release(stage: ReverbStage): void {
    this.unfeed(stage);
    stage.convolver.disconnect();
  }

  /** Offline renders (WAV export) rebuild immediately so the render always
   * uses the final settings; live, rapid knob drags are coalesced. */
  private reshape(change: Partial<ImpulseParams>): void {
    const next = { ...this.impulse, ...change };
    if (
      next.decay === this.impulse.decay &&
      next.damping === this.impulse.damping &&
      next.early === this.impulse.early &&
      next.width === this.impulse.width &&
      next.mode === this.impulse.mode
    ) {
      return;
    }
    this.impulse = next;
    if (this.context instanceof Tone.OfflineContext) {
      this.swapImpulse(false);
      return;
    }
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      if (!this.isDisposed) this.swapImpulse(true);
    }, REVERB_REBUILD_DEBOUNCE_MS);
  }

  setDecay(v: number): void {
    this.reshape({ decay: v });
  }

  setDamping(v: number): void {
    this.reshape({ damping: v });
  }

  setEarly(v: number): void {
    this.reshape({ early: v });
  }

  setWidth(v: number): void {
    this.reshape({ width: v });
  }

  setMode(v: number): void {
    this.reshape({ mode: reverbModeFromParam(v) });
  }

  setPreDelay(seconds: number): void {
    this.preDelay.delayTime.value = seconds;
  }

  setLowCut(frequency: number): void {
    this.lowCut.frequency.value = frequency;
  }

  setHighCut(frequency: number): void {
    this.highCut.frequency.value = frequency;
  }

  setWet(mix: number): void {
    this.dryGain.gain.value = 1 - mix;
    this.wetGain.gain.value = mix;
  }

  dispose(): this {
    super.dispose();
    this.isDisposed = true;
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    if (this.current) this.release(this.current);
    this.ringingOut.forEach((stage) => this.release(stage));
    this.ringingOut.clear();
    this.lowCut.dispose();
    this.highCut.dispose();
    this.preDelay.dispose();
    this.dryGain.dispose();
    this.wetGain.dispose();
    this.input.dispose();
    this.output.dispose();
    return this;
  }
}

/** The Filter effect: one of seven biquad types, cascaded to 12/24/48dB
 * per octave (see filterModel.ts for the stage design), with an LFO sweeping
 * the cutoff and a dry/wet blend. The LFO drives every stage's `detune`
 * param (cents), so it sweeps the cutoff evenly in octaves rather than in
 * Hz. Stages are only rebuilt when the type or slope changes their count
 * or kind; knob moves just update values. */
export class FilterChain extends Tone.ToneAudioNode {
  readonly name = "FilterChain";
  readonly input = new Tone.Gain();
  readonly output = new Tone.Gain();
  private readonly wetIn = new Tone.Gain();
  private readonly dryGain: Tone.Gain;
  private readonly wetGain: Tone.Gain;
  private readonly lfo: Tone.LFO;
  private stages: Tone.BiquadFilter[] = [];
  private mode: FilterMode;
  private frequency: number;
  private q: number;
  private gainDb: number;
  private slope: number;

  constructor(params: Record<string, number>) {
    super();
    this.mode = filterModeFromParam(params.mode);
    this.frequency = params.frequency;
    this.q = params.Q;
    this.gainDb = params.gain;
    this.slope = slopeIndexFromParam(params.slope);
    this.dryGain = new Tone.Gain(1 - params.wet);
    this.wetGain = new Tone.Gain(params.wet);
    this.lfo = new Tone.LFO({ frequency: params.lfoRate, min: 0, max: 0 }).start();

    this.input.connect(this.dryGain);
    this.dryGain.connect(this.output);
    this.input.connect(this.wetIn);
    this.wetGain.connect(this.output);
    this.setLfoDepth(params.lfoDepth);
    this.applyDesign();
  }

  private applyDesign(): void {
    const design = designFilter(this.mode, this.frequency, this.q, this.gainDb, this.slope);
    const reusable =
      design.length === this.stages.length && design.every((stage, i) => this.stages[i].type === stage.type);
    if (!reusable) {
      this.wetIn.disconnect();
      this.lfo.disconnect();
      this.stages.forEach((stage) => stage.dispose());
      this.stages = design.map((d) => new Tone.BiquadFilter({ type: d.type, frequency: d.frequency, Q: d.nativeQ, gain: d.gain }));
      this.wetIn.chain(...this.stages, this.wetGain);
      this.stages.forEach((stage) => this.lfo.connect(stage.detune));
    }
    design.forEach((d, i) => {
      const stage = this.stages[i];
      stage.frequency.value = d.frequency;
      stage.Q.value = d.nativeQ;
      stage.gain.value = d.gain;
    });
  }

  setFrequency(hz: number): void {
    this.frequency = hz;
    this.applyDesign();
  }

  setQ(q: number): void {
    this.q = q;
    this.applyDesign();
  }

  setGain(db: number): void {
    this.gainDb = db;
    this.applyDesign();
  }

  setMode(v: number): void {
    this.mode = filterModeFromParam(v);
    this.applyDesign();
  }

  setSlope(v: number): void {
    this.slope = slopeIndexFromParam(v);
    this.applyDesign();
  }

  setLfoRate(hz: number): void {
    this.lfo.frequency.value = hz;
  }

  setLfoDepth(amount: number): void {
    const cents = amount * LFO_MAX_OCTAVES * 1200;
    this.lfo.min = -cents;
    this.lfo.max = cents;
  }

  setWet(mix: number): void {
    this.dryGain.gain.value = 1 - mix;
    this.wetGain.gain.value = mix;
  }

  dispose(): this {
    super.dispose();
    this.lfo.dispose();
    this.stages.forEach((stage) => stage.dispose());
    this.wetIn.dispose();
    this.dryGain.dispose();
    this.wetGain.dispose();
    this.input.dispose();
    this.output.dispose();
    return this;
  }
}

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


/** The IR Loader: convolves with an uploaded impulse response (a speaker
 * cab, a room, ...), then low cut -> high cut -> output gain, blended
 * linearly with the dry signal. With no IR loaded the wet path passes audio
 * through unchanged. Swapping the IR (or toggling Normalize) feeds a fresh
 * ConvolverNode while the old one rings out, so a change mid-playback
 * doesn't cut the sound off. Native ConvolverNodes are used for the same
 * reason as ReverbChain's: Tone.Convolver forces `normalize` back on. */
export class IrLoaderChain extends Tone.ToneAudioNode {
  readonly name = "IrLoaderChain";
  readonly input = new Tone.Gain();
  readonly output = new Tone.Gain();
  private readonly wetIn = new Tone.Gain();
  private readonly direct = new Tone.Gain();
  private readonly lowCut: Tone.Filter;
  private readonly highCut: Tone.Filter;
  private readonly outputGain: Tone.Gain;
  private readonly dryGain: Tone.Gain;
  private readonly wetGain: Tone.Gain;
  private raw: AudioBuffer | null = null;
  private normalize: boolean;
  private convolver: ConvolverNode | null = null;
  private readonly ringingOut = new Set<ConvolverNode>();
  private isDisposed = false;

  constructor(params: Record<string, number>) {
    super();
    const sampleRate = this.context.sampleRate;
    this.lowCut = new Tone.Filter({ type: "highpass", frequency: effectiveLowCut(params.lowCut), Q: Math.SQRT1_2 });
    this.highCut = new Tone.Filter({
      type: "lowpass",
      frequency: effectiveHighCut(params.highCut, sampleRate),
      Q: Math.SQRT1_2,
    });
    this.outputGain = new Tone.Gain(Tone.dbToGain(params.output));
    this.dryGain = new Tone.Gain(1 - params.wet);
    this.wetGain = new Tone.Gain(params.wet);
    this.normalize = params.normalize >= 0.5;

    this.input.connect(this.dryGain);
    this.dryGain.connect(this.output);
    this.input.connect(this.wetIn);
    this.wetIn.connect(this.direct);
    this.direct.connect(this.lowCut);
    this.lowCut.chain(this.highCut, this.outputGain, this.wetGain, this.output);
  }

  /** The IR to convolve with (decoded at this context's sample rate), or
   * null to pass the wet path straight through. */
  setImpulse(buffer: AudioBuffer | null): void {
    if (this.isDisposed) return;
    this.raw = buffer;
    this.rebuild();
  }

  get hasImpulse(): boolean {
    return this.raw !== null;
  }

  private rebuild(): void {
    const previous = this.convolver;
    this.convolver = null;
    if (previous) {
      this.wetIn.disconnect(previous);
      this.ringingOut.add(previous);
      const tailMs = (previous.buffer?.duration ?? 0) * 1000 + 200;
      setTimeout(() => {
        if (this.ringingOut.delete(previous)) previous.disconnect();
      }, tailMs);
    } else {
      this.wetIn.disconnect(this.direct);
    }

    const raw = this.raw;
    if (!raw || raw.sampleRate !== this.context.sampleRate) {
      this.wetIn.connect(this.direct);
      return;
    }
    const sources = convolverChannels(
      Array.from({ length: raw.numberOfChannels }, (_, i) => raw.getChannelData(i))
    );
    const gain = this.normalize ? irNormalizationGain(sources) : 1;
    const buffer = this.context.createBuffer(sources.length, raw.length, raw.sampleRate);
    sources.forEach((data, i) => {
      const scaled = new Float32Array(data.length);
      for (let j = 0; j < data.length; j++) scaled[j] = data[j] * gain;
      buffer.copyToChannel(scaled, i);
    });
    const convolver = this.context.createConvolver();
    convolver.normalize = false;
    convolver.buffer = buffer;
    this.wetIn.connect(convolver);
    Tone.connect(convolver, this.lowCut);
    this.convolver = convolver;
  }

  setNormalize(on: boolean): void {
    if (on === this.normalize) return;
    this.normalize = on;
    if (this.raw) this.rebuild();
  }

  setLowCut(value: number): void {
    this.lowCut.frequency.value = effectiveLowCut(value);
  }

  setHighCut(value: number): void {
    this.highCut.frequency.value = effectiveHighCut(value, this.context.sampleRate);
  }

  setOutput(db: number): void {
    this.outputGain.gain.value = Tone.dbToGain(db);
  }

  setWet(mix: number): void {
    this.dryGain.gain.value = 1 - mix;
    this.wetGain.gain.value = mix;
  }

  dispose(): this {
    super.dispose();
    this.isDisposed = true;
    this.convolver?.disconnect();
    this.ringingOut.forEach((c) => c.disconnect());
    this.ringingOut.clear();
    this.wetIn.dispose();
    this.direct.dispose();
    this.lowCut.dispose();
    this.highCut.dispose();
    this.outputGain.dispose();
    this.dryGain.dispose();
    this.wetGain.dispose();
    this.input.dispose();
    this.output.dispose();
    return this;
  }
}

export function createEffectNode(type: EffectType, savedParams: Record<string, number>): Tone.ToneAudioNode {
  // Params saved before an effect gained new controls lack those keys (the
  // live engine fills them via addEffect's defaults, but the WAV export
  // builds straight from saved params) - fill them in so nothing gets NaN.
  const params = { ...defaultParams(type), ...savedParams };
  switch (type) {
    case "eq3":
      return new Tone.EQ3({
        low: params.low,
        mid: params.mid,
        high: params.high,
        lowFrequency: params.lowFrequency,
        highFrequency: params.highFrequency,
      });
    case "compressor":
      return new CompressorChain(params);
    case "delay":
      return new DelayChain(params);
    case "reverb":
      return new ReverbChain(params);
    case "chorus":
      return new ChorusChain(params);
    case "distortion":
      return new SaturatorChain(params);
    case "filter":
      return new FilterChain(params);
    case "limiter":
      // Not Tone.Limiter (a native compressor): see lookaheadLimiter.ts.
      return new LookaheadLimiter({
        ceilingDb: params.threshold,
        gainDb: params.gain,
        release: params.release,
        softClip: params.softClip >= 0.5,
      });
    case "pitchShift":
      // Not Tone.PitchShift, which is out of tune - see pitchShifter.ts.
      return new PitchShifter({
        pitch: params.pitch,
        fine: params.fine,
        window: params.window,
        feedback: params.feedback,
        wet: params.wet,
      });
    case "irLoader":
      return new IrLoaderChain(params);
    case "namAmp":
      return new NamAmpChain(params);
    case "gate":
      return new NoiseGate(params);
    case "paramEq":
      return new ParamEqChain(params);
    case "multiband":
      return new MultibandChain(params);
    case "utility":
      return new UtilityChain(params);
    case "tuner":
      return new TunerChain(params);
    case "glue":
      return new GlueChain(params);
    case "tubeAmp":
      return new AmpSimChain(params);
    case "mbDynamics":
      return new MbDynamicsChain(params);
  }
}

export function applyEffectParam(
  node: Tone.ToneAudioNode,
  type: EffectType,
  key: string,
  value: number
): void {
  switch (type) {
    case "eq3": {
      const eq = node as Tone.EQ3;
      if (key === "low") eq.low.value = value;
      else if (key === "mid") eq.mid.value = value;
      else if (key === "high") eq.high.value = value;
      else if (key === "lowFrequency") eq.lowFrequency.value = value;
      else if (key === "highFrequency") eq.highFrequency.value = value;
      break;
    }
    case "compressor":
      (node as CompressorChain).setParam(key, value);
      break;
    case "delay": {
      const delay = node as DelayChain;
      if (key === "delayTimeL") delay.setDelayTimeL(value);
      else if (key === "delayTimeR") delay.setDelayTimeR(value);
      else if (key === "feedback") delay.setFeedback(value);
      else if (key === "lowCut") delay.setLowCut(value);
      else if (key === "highCut") delay.setHighCut(value);
      else if (key === "wet") delay.setWet(value);
      else if (key === "filterOn") delay.setFilterOn(value >= 0.5);
      else if (key === "pingPong") delay.setPingPong(value >= 0.5);
      else if (key === "freeze") delay.setFreeze(value >= 0.5);
      break;
    }
    case "reverb": {
      const reverb = node as ReverbChain;
      if (key === "preDelay") reverb.setPreDelay(value);
      else if (key === "decay") reverb.setDecay(value);
      else if (key === "damping") reverb.setDamping(value);
      else if (key === "early") reverb.setEarly(value);
      else if (key === "lowCut") reverb.setLowCut(value);
      else if (key === "highCut") reverb.setHighCut(value);
      else if (key === "width") reverb.setWidth(value);
      else if (key === "wet") reverb.setWet(value);
      else if (key === "mode") reverb.setMode(value);
      break;
    }
    case "chorus": {
      const chorus = node as ChorusChain;
      if (key === "frequency") chorus.setRate(value);
      else if (key === "delayTime") chorus.setDelay(value);
      else if (key === "depth") chorus.setDepth(value);
      else if (key === "feedback") chorus.setFeedback(value);
      else if (key === "spread") chorus.setSpread(value);
      else if (key === "wet") chorus.setWet(value);
      else if (key === "waveform") chorus.setWaveform(value);
      break;
    }
    case "distortion":
      (node as SaturatorChain).setParam(key, value);
      break;
    case "filter": {
      const filter = node as FilterChain;
      if (key === "frequency") filter.setFrequency(value);
      else if (key === "Q") filter.setQ(value);
      else if (key === "gain") filter.setGain(value);
      else if (key === "mode") filter.setMode(value);
      else if (key === "slope") filter.setSlope(value);
      else if (key === "lfoRate") filter.setLfoRate(value);
      else if (key === "lfoDepth") filter.setLfoDepth(value);
      else if (key === "wet") filter.setWet(value);
      // Automation recorded on the pre-plugin 0..1 "type" knob.
      else if (key === "type") filter.setMode(legacyFilterTypeToMode(value));
      break;
    }
    case "limiter": {
      const limiter = node as LookaheadLimiter;
      if (key === "threshold") limiter.setCeiling(value);
      else if (key === "gain") limiter.setGain(value);
      else if (key === "release") limiter.setRelease(value);
      else if (key === "softClip") limiter.setSoftClip(value >= 0.5);
      break;
    }
    case "pitchShift": {
      const shift = node as PitchShifter;
      if (key === "pitch") shift.setPitch(value);
      else if (key === "fine") shift.setFine(value);
      else if (key === "window") shift.setWindow(value);
      else if (key === "feedback") shift.setFeedback(value);
      else if (key === "wet") shift.setWet(value);
      break;
    }
    case "irLoader": {
      const ir = node as IrLoaderChain;
      if (key === "lowCut") ir.setLowCut(value);
      else if (key === "highCut") ir.setHighCut(value);
      else if (key === "output") ir.setOutput(value);
      else if (key === "wet") ir.setWet(value);
      else if (key === "normalize") ir.setNormalize(value >= 0.5);
      break;
    }
    case "namAmp": {
      const amp = node as NamAmpChain;
      if (key === "input") amp.setInput(value);
      else if (key === "bass" || key === "middle" || key === "treble") amp.setTone(key, value);
      else if (key === "output") amp.setOutput(value);
      else if (key === "normalize") amp.setNormalize(value >= 0.5);
      else if (key === "size") amp.setSize(value);
      break;
    }
    case "gate":
      (node as NoiseGate).setParam(key, value);
      break;
    case "paramEq":
      (node as ParamEqChain).setParam(key, value);
      break;
    case "multiband":
      (node as MultibandChain).setParam(key, value);
      break;
    case "utility":
      (node as UtilityChain).setParam(key, value);
      break;
    case "tubeAmp":
      (node as AmpSimChain).setParam(key, value);
      break;
    case "glue":
      (node as GlueChain).setParam(key, value);
      break;
    case "mbDynamics":
      (node as MbDynamicsChain).setParam(key, value);
      break;
    case "tuner":
      if (key === "mute") (node as TunerChain).setMute(value >= 0.5);
      break;
  }
}
