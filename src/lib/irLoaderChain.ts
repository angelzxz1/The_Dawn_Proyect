import * as Tone from "tone";
import { convolverChannels, effectiveHighCut, effectiveLowCut, irNormalizationGain } from "./irModel";

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
