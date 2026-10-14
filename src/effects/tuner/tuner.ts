import * as Tone from "tone";

// The Tuner effect: audio passes straight through (or is muted, for tuning
// silently), and an analyser keeps the latest ~85 ms of the input for the
// window/card to detect pitch from (see tunerModel.ts). Detection runs on
// the main thread only while a tuner is on screen.

/** Samples analysed per reading: 4096 at 48 kHz, enough for a low B. */
const WINDOW = 4096;

export class TunerChain extends Tone.ToneAudioNode {
  readonly name = "TunerChain";
  readonly input = new Tone.Gain();
  readonly output = new Tone.Gain();
  private readonly analyser = new Tone.Analyser({ type: "waveform", size: WINDOW });

  constructor(params: Record<string, number>) {
    super();
    // The analyser hangs off the input, which the effect chain's rewiring
    // never disconnects.
    this.input.connect(this.analyser);
    this.input.connect(this.output);
    this.setMute((params.mute ?? 0) >= 0.5);
  }

  setMute(mute: boolean): void {
    this.output.gain.rampTo(mute ? 0 : 1, 0.01);
  }

  /** The latest input audio (mono), for pitch detection. */
  get waveform(): Float32Array {
    return this.analyser.getValue() as Float32Array;
  }

  dispose(): this {
    super.dispose();
    this.analyser.dispose();
    this.input.dispose();
    this.output.dispose();
    return this;
  }
}
