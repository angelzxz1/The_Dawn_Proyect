import * as Tone from "tone";
import type { Instrument } from "./drumKit";
import type { SynthParams } from "./types";

export const SYNTH_PRESETS: { name: string; params: SynthParams }[] = [
  {
    name: "Lead",
    params: {
      mode: "subtractive",
      oscillatorType: "sawtooth",
      attack: 0.01,
      decay: 0.15,
      sustain: 0.6,
      release: 0.2,
      filterCutoff: 3200,
      filterResonance: 1.5,
      harmonicity: 2,
      modulationIndex: 8,
      detune: 0,
    },
  },
  {
    name: "Pad",
    params: {
      mode: "subtractive",
      oscillatorType: "triangle",
      attack: 0.6,
      decay: 0.5,
      sustain: 0.8,
      release: 1.8,
      filterCutoff: 1400,
      filterResonance: 0.8,
      harmonicity: 1.5,
      modulationIndex: 4,
      detune: 0,
    },
  },
  {
    name: "Bass",
    params: {
      mode: "subtractive",
      oscillatorType: "square",
      attack: 0.005,
      decay: 0.2,
      sustain: 0.4,
      release: 0.15,
      filterCutoff: 600,
      filterResonance: 2,
      harmonicity: 1,
      modulationIndex: 2,
      detune: 0,
    },
  },
  {
    name: "Pluck",
    params: {
      mode: "subtractive",
      oscillatorType: "triangle",
      attack: 0.001,
      decay: 0.25,
      sustain: 0,
      release: 0.15,
      filterCutoff: 2400,
      filterResonance: 1,
      harmonicity: 1,
      modulationIndex: 2,
      detune: 0,
    },
  },
  {
    name: "FM Bell",
    params: {
      mode: "fm",
      oscillatorType: "sine",
      attack: 0.005,
      decay: 1.2,
      sustain: 0.1,
      release: 1.2,
      filterCutoff: 8000,
      filterResonance: 0.5,
      harmonicity: 3.5,
      modulationIndex: 18,
      detune: 0,
    },
  },
];

export function defaultSynthParams(): SynthParams {
  return { ...SYNTH_PRESETS[0].params };
}

/**
 * A polyphonic synth instrument - either subtractive (an oscillator through
 * a resonant lowpass filter) or FM (a Tone.FMSynth voice), switchable live.
 * Implements the same `Instrument` surface as the Sampler/DrumKit so the
 * engine can swap it in wherever those go, plus two extra live-modulation
 * hooks (`setDetune`/`setModWheel`) the base `Instrument` interface leaves
 * optional - a sampler/drum kit has no sensible way to honor either, but a
 * synth voice built from real oscillators does.
 */
export class SynthInstrument implements Instrument {
  private output = new Tone.Gain(1);
  private filter: Tone.Filter;
  private voice: Tone.PolySynth<Tone.Synth> | Tone.PolySynth<Tone.FMSynth>;
  private params: SynthParams;
  private baseCutoff: number;
  private modWheelAmount = 0;

  constructor(params: SynthParams) {
    this.params = params;
    this.baseCutoff = params.filterCutoff;
    this.filter = new Tone.Filter({
      type: "lowpass",
      frequency: params.filterCutoff,
      Q: params.filterResonance,
    }).connect(this.output);
    this.voice = this.buildVoice(params);
    this.voice.connect(this.filter);
  }

  private buildVoice(params: SynthParams) {
    const envelope = {
      attack: params.attack,
      decay: params.decay,
      sustain: params.sustain,
      release: params.release,
    };
    if (params.mode === "fm") {
      return new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: params.harmonicity,
        modulationIndex: params.modulationIndex,
        detune: params.detune,
        envelope,
      });
    }
    return new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: params.oscillatorType },
      detune: params.detune,
      envelope,
    });
  }

  /** Applies a full new param set - rebuilds the voice only when switching
   * subtractive/FM mode (a different underlying Tone class); every other
   * change is applied live via `.set()` so notes already sounding pick it
   * up smoothly instead of cutting off. */
  setParams(params: SynthParams): void {
    const modeChanged = params.mode !== this.params.mode;
    this.params = params;
    this.baseCutoff = params.filterCutoff;
    if (modeChanged) {
      this.voice.disconnect();
      this.voice.dispose();
      this.voice = this.buildVoice(params);
      this.voice.connect(this.filter);
    } else {
      const envelope = {
        attack: params.attack,
        decay: params.decay,
        sustain: params.sustain,
        release: params.release,
      };
      if (params.mode === "fm") {
        (this.voice as Tone.PolySynth<Tone.FMSynth>).set({
          harmonicity: params.harmonicity,
          modulationIndex: params.modulationIndex,
          detune: params.detune,
          envelope,
        });
      } else {
        (this.voice as Tone.PolySynth<Tone.Synth>).set({
          oscillator: { type: params.oscillatorType },
          detune: params.detune,
          envelope,
        });
      }
    }
    this.filter.Q.value = params.filterResonance;
    this.filter.frequency.value = params.filterCutoff * (1 + this.modWheelAmount);
  }

  /** Live pitch-bend: shifts every currently-sounding and future voice by
   * `cents`, exactly like a hardware synth's pitch wheel. */
  setDetune(cents: number): void {
    this.voice.set({ detune: this.params.detune + cents } as Partial<
      Tone.FMSynthOptions | Tone.SynthOptions
    >);
  }

  /** Live mod wheel: sweeps the filter cutoff open, a simple but audible
   * stand-in for real synths' vibrato/filter-mod wheel routing. */
  setModWheel(amount: number): void {
    this.modWheelAmount = Math.max(0, Math.min(1, amount));
    this.filter.frequency.value = this.baseCutoff * (1 + this.modWheelAmount * 3);
  }

  connect(node: Tone.InputNode): this {
    this.output.connect(node);
    return this;
  }

  disconnect(): this {
    this.output.disconnect();
    return this;
  }

  triggerAttack(note: string, time?: Tone.Unit.Time, velocity = 0.8): void {
    this.voice.triggerAttack(note, time, velocity);
  }

  triggerRelease(note: string, time?: Tone.Unit.Time): void {
    this.voice.triggerRelease(note, time);
  }

  triggerAttackRelease(
    note: string,
    duration: Tone.Unit.Time,
    time?: Tone.Unit.Time,
    velocity = 0.8
  ): void {
    this.voice.triggerAttackRelease(note, duration, time, velocity);
  }

  releaseAll(time?: Tone.Unit.Time): void {
    this.voice.releaseAll(time);
  }

  dispose(): void {
    this.voice.dispose();
    this.filter.dispose();
    this.output.dispose();
  }
}
