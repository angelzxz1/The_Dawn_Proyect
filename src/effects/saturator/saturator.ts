import * as Tone from "tone";
import {
  COLOR_SHELF_HZ,
  CURVE_HEADROOM,
  colorGains,
  colorSettingsFromParams,
  distortionCurve,
  distortionShapeFromParam,
  oversampleFromParam,
  softClipCurve,
} from "./saturatorModel";
import { nativeLatencies } from "../../engine/nativeLatency";

// The Saturator (the "distortion" effect type):
//
//   in -> color pre (shelf, bell) -> shaper (Drive, Bias, curve; 2x/4x
//   oversampling) -> DC blocker -> color post -> Tone low-pass -> Output
//   -> Soft Clip -> wet
//   in -> (delayed to match oversampling) -> dry
//
// Drive, Bias and the curve are baked into one WaveShaperNode curve (see
// saturatorModel.ts). The color EQ is plain biquads; at 0 dB they pass
// the signal untouched.

export class SaturatorChain extends Tone.ToneAudioNode {
  readonly name = "SaturatorChain";
  readonly input = new Tone.Gain();
  readonly output = new Tone.Gain();
  private readonly preBase = new Tone.Filter({ type: "lowshelf", frequency: COLOR_SHELF_HZ, rolloff: -12 });
  private readonly preBell = new Tone.Filter({ type: "peaking", rolloff: -12 });
  private readonly headroom = new Tone.Gain(1 / CURVE_HEADROOM);
  private readonly shaper = new Tone.WaveShaper();
  private readonly dcBlock = new Tone.Filter({ type: "highpass", frequency: 10, Q: Math.SQRT1_2 });
  private readonly postBase = new Tone.Filter({ type: "lowshelf", frequency: COLOR_SHELF_HZ, rolloff: -12 });
  private readonly postBell = new Tone.Filter({ type: "peaking", rolloff: -12 });
  private readonly toneFilter = new Tone.Filter({ type: "lowpass", Q: Math.SQRT1_2 });
  private readonly outputGain = new Tone.Volume(0);
  private readonly clipIn = new Tone.Gain(1 / CURVE_HEADROOM);
  private readonly clipper = new Tone.WaveShaper(softClipCurve());
  private readonly clipBypass = new Tone.Gain();
  private readonly dryGain = new Tone.Gain();
  private readonly wetGain = new Tone.Gain();
  /** Oversampling delays the shaped signal; the dry path waits the same so
   * a Dry/Wet blend doesn't comb-filter. */
  private readonly dryDelay = new Tone.Delay(0, 0.1);
  private readonly params: Record<string, number>;
  private softClipOn = false;

  constructor(params: Record<string, number>) {
    super();
    this.params = { ...params };
    this.input.chain(this.dryDelay, this.dryGain, this.output);
    this.input.chain(this.preBase, this.preBell, this.headroom, this.shaper, this.dcBlock, this.postBase, this.postBell, this.toneFilter, this.outputGain);
    this.outputGain.connect(this.clipBypass);
    this.clipBypass.connect(this.wetGain);
    this.clipIn.chain(this.clipper, this.wetGain);
    this.wetGain.connect(this.output);
    this.rebuildCurve();
    this.applyColor();
    this.toneFilter.frequency.value = params.tone;
    this.outputGain.volume.value = params.output;
    this.setSoftClip((params.softClip ?? 0) >= 0.5);
    this.setOversample(params.oversample);
    this.setWet(params.wet);
  }

  setParam(key: string, value: number): void {
    this.params[key] = value;
    if (key === "distortion" || key === "bias" || key === "shape") this.rebuildCurve();
    else if (key.startsWith("color")) this.applyColor();
    else if (key === "tone") this.toneFilter.frequency.value = value;
    else if (key === "output") this.outputGain.volume.value = value;
    else if (key === "oversample") this.setOversample(value);
    else if (key === "wet") this.setWet(value);
    else if (key === "softClip") this.setSoftClip(value >= 0.5);
  }

  private rebuildCurve(): void {
    const p = this.params;
    this.shaper.curve = distortionCurve(distortionShapeFromParam(p.shape), p.distortion, p.bias);
  }

  private applyColor(): void {
    const c = colorSettingsFromParams(this.params);
    const g = colorGains(c);
    this.preBase.gain.value = g.pre.base;
    this.postBase.gain.value = g.post.base;
    for (const bell of [this.preBell, this.postBell]) {
      bell.frequency.value = c.freq;
      bell.Q.value = c.q;
    }
    this.preBell.gain.value = g.pre.depth;
    this.postBell.gain.value = g.post.depth;
  }

  private setSoftClip(on: boolean): void {
    if (on === this.softClipOn) return;
    this.softClipOn = on;
    this.outputGain.disconnect();
    this.outputGain.connect(on ? this.clipIn : this.clipBypass);
  }

  private setOversample(v: number): void {
    this.shaper.oversample = oversampleFromParam(v);
    this.dryDelay.delayTime.value = this.latency;
  }

  /** Seconds the oversampling filters delay the shaped signal. */
  get latency(): number {
    const native = nativeLatencies();
    const o = this.shaper.oversample;
    return (o === "4x" ? native.shaper4x : o === "2x" ? native.shaper2x : 0) / this.context.sampleRate;
  }

  private setWet(mix: number): void {
    this.dryGain.gain.value = Math.cos((mix * Math.PI) / 2);
    this.wetGain.gain.value = Math.sin((mix * Math.PI) / 2);
  }

  dispose(): this {
    super.dispose();
    [
      this.preBase,
      this.preBell,
      this.headroom,
      this.shaper,
      this.dcBlock,
      this.postBase,
      this.postBell,
      this.toneFilter,
      this.outputGain,
      this.clipIn,
      this.clipper,
      this.clipBypass,
      this.dryDelay,
      this.dryGain,
      this.wetGain,
      this.input,
      this.output,
    ].forEach((n) => n.dispose());
    return this;
  }
}
