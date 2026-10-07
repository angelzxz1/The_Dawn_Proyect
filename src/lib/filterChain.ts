import * as Tone from "tone";
import {
  type FilterMode,
  LFO_MAX_OCTAVES,
  designFilter,
  filterModeFromParam,
  slopeIndexFromParam,
} from "./filterModel";

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
