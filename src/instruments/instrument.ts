import * as Tone from "tone";

/** The subset of Tone.Sampler's API the audio engine drives an instrument
 * through, so a DrumKit can be swapped in wherever a Sampler was used. */
export interface Instrument {
  triggerAttack(note: string, time?: Tone.Unit.Time, velocity?: number): void;
  triggerRelease(note: string, time?: Tone.Unit.Time): void;
  triggerAttackRelease(
    note: string,
    duration: Tone.Unit.Time,
    time?: Tone.Unit.Time,
    velocity?: number
  ): void;
  releaseAll(time?: Tone.Unit.Time): void;
  connect(node: Tone.InputNode): this;
  disconnect(): this;
  dispose(): void;
  /** Live pitch-bend, in cents - optional since a sampler/drum kit has no
   * sensible way to honor it; only a real oscillator-based synth voice
   * implements this. */
  setDetune?(cents: number): void;
  /** Live mod wheel, 0..1 - same optionality as `setDetune`. */
  setModWheel?(amount: number): void;
  /** Resolves once it can play, for one that loads something first (the
   * synth's wavetables, the Drum Rack's samples). */
  readonly ready?: Promise<void>;
}

/**
 * The instrument for a MIDI track with nothing loaded into it - a track
 * doesn't have to have an instrument, so this plugs the same slot as a
 * Sampler or DrumKit but simply produces no sound.
 */
export class NullInstrument implements Instrument {
  private output = new Tone.Gain(0);

  connect(node: Tone.InputNode): this {
    this.output.connect(node);
    return this;
  }

  disconnect(): this {
    this.output.disconnect();
    return this;
  }

  triggerAttack(): void {}
  triggerRelease(): void {}
  triggerAttackRelease(): void {}
  releaseAll(): void {}

  dispose(): void {
    this.output.dispose();
  }
}
