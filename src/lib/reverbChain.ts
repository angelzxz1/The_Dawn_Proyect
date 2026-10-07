import * as Tone from "tone";
import { type ImpulseParams, renderImpulse, reverbModeFromParam } from "./reverbModel";

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
