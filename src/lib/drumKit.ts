import * as Tone from "tone";
import { drumLabelForNote } from "./drums";

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

const TOM_PITCH: Record<string, string> = {
  F1: "G2",
  G1: "A#2",
  A1: "D3",
};

/**
 * A compact but genuinely usable drum kit built from synthesized voices
 * (no samples to load) - punchy kick/snare, a filtered-noise clap and
 * hi-hats, and metallic crash/ride, mapped onto the notes in drums.ts.
 * Not a "toy" beep kit: each voice has its own envelope tuned to sound
 * like the instrument it's standing in for.
 */
export class DrumKit implements Instrument {
  private output = new Tone.Gain(1);

  private kick = new Tone.MembraneSynth({
    pitchDecay: 0.045,
    octaves: 7,
    oscillator: { type: "sine" },
    envelope: { attack: 0.001, decay: 0.4, sustain: 0.001, release: 0.4 },
  }).connect(this.output);

  private snareNoise = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.18, sustain: 0 },
  }).connect(this.output);

  private snareBody = new Tone.MembraneSynth({
    pitchDecay: 0.02,
    octaves: 4,
    envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.12 },
  }).connect(this.output);

  private clap = new Tone.NoiseSynth({
    noise: { type: "pink" },
    envelope: { attack: 0.001, decay: 0.22, sustain: 0 },
  }).connect(this.output);

  private toms = new Tone.MembraneSynth({
    pitchDecay: 0.03,
    octaves: 3.5,
    envelope: { attack: 0.001, decay: 0.5, sustain: 0.01, release: 0.5 },
  }).connect(this.output);

  private hihatClosed = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.06, release: 0.02 },
    harmonicity: 5.1,
    modulationIndex: 32,
    resonance: 4000,
    octaves: 1.5,
  }).connect(this.output);

  private hihatOpen = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.5, release: 0.15 },
    harmonicity: 5.1,
    modulationIndex: 32,
    resonance: 4000,
    octaves: 1.5,
  }).connect(this.output);

  private crash = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 1.4, release: 0.4 },
    harmonicity: 4.2,
    modulationIndex: 22,
    resonance: 3200,
    octaves: 2.2,
  }).connect(this.output);

  private ride = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.9, release: 0.3 },
    harmonicity: 6.5,
    modulationIndex: 14,
    resonance: 5200,
    octaves: 1.2,
  }).connect(this.output);

  connect(node: Tone.InputNode): this {
    this.output.connect(node);
    return this;
  }

  disconnect(): this {
    this.output.disconnect();
    return this;
  }

  /** Percussive one-shots self-terminate; there's no "held" state to
   * trigger and release like a sustained instrument, so a hit is played
   * on attack and the duration/release calls are no-ops. */
  triggerAttack(note: string, time?: Tone.Unit.Time, velocity = 0.8): void {
    const at = time ?? Tone.now();
    switch (drumLabelForNote(note)) {
      case "Kick":
        this.kick.triggerAttackRelease("C1", 0.35, at, velocity);
        break;
      case "Snare":
        this.snareNoise.triggerAttackRelease("8n", at, velocity);
        this.snareBody.triggerAttackRelease("A2", "16n", at, velocity * 0.8);
        break;
      case "Clap":
        this.clap.triggerAttackRelease("16n", at, velocity);
        break;
      case "Low Tom":
      case "Mid Tom":
      case "High Tom":
        this.toms.triggerAttackRelease(TOM_PITCH[note] ?? "A2", "8n", at, velocity);
        break;
      case "Closed Hat":
        this.hihatClosed.triggerAttackRelease("C6", "32n", at, velocity * 0.85);
        break;
      case "Open Hat":
        this.hihatOpen.triggerAttackRelease("C6", "4n", at, velocity * 0.85);
        break;
      case "Crash":
        this.crash.triggerAttackRelease("C5", "2n", at, velocity);
        break;
      case "Ride":
        this.ride.triggerAttackRelease("C5", "4n", at, velocity * 0.75);
        break;
      default:
      // Unmapped note (outside the drum rack's pads) - nothing to play.
    }
  }

  triggerRelease(): void {
    // No-op: every voice above already schedules its own release.
  }

  triggerAttackRelease(
    note: string,
    _duration: Tone.Unit.Time,
    time?: Tone.Unit.Time,
    velocity = 0.8
  ): void {
    this.triggerAttack(note, time, velocity);
  }

  releaseAll(): void {
    // No sustained voices to release.
  }

  dispose(): void {
    this.kick.dispose();
    this.snareNoise.dispose();
    this.snareBody.dispose();
    this.clap.dispose();
    this.toms.dispose();
    this.hihatClosed.dispose();
    this.hihatOpen.dispose();
    this.crash.dispose();
    this.ride.dispose();
    this.output.dispose();
  }
}
