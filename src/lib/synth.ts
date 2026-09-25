import * as Tone from "tone";
import type { Instrument } from "./drumKit";
import type { OscillatorParams, SynthParams } from "./types";
import { WAVETABLES, wavetablePartialsAt } from "./wavetables";

const MAX_POLYPHONY = 8;

function noteToFrequency(note: string): number {
  return Tone.Frequency(note).toFrequency();
}

/** The fixed octave/semitone/fine-tune offset for one oscillator, in cents -
 * applied to its `detune` param so a single Signal carries both this static
 * tuning and any live modulation (pitch bend, vibrato LFO) added on top. */
function staticTuningCents(osc: OscillatorParams): number {
  return osc.octave * 1200 + osc.semitone * 100 + osc.fineCents;
}

/** One polyphonic voice: two wavetable oscillators + a sub, summed into a
 * filter (with its own envelope) then an amplitude envelope. Both
 * oscillators run continuously once started - only the amp envelope gates
 * audibility - so retuning/stealing a voice for a new note never has to
 * restart a native audio source (the exact click-prone pattern that turned
 * out to cause the audio-clip resize glitch elsewhere in this engine). */
class Voice {
  readonly output: Tone.Gain;
  private oscA: Tone.FatOscillator;
  private oscB: Tone.FatOscillator;
  private sub: Tone.Oscillator;
  private oscAGain: Tone.Gain;
  private oscBGain: Tone.Gain;
  private subGain: Tone.Gain;
  private filter: Tone.Filter;
  private filterEnvelope: Tone.FrequencyEnvelope;
  private ampEnvelope: Tone.AmplitudeEnvelope;
  private lfo: Tone.LFO;
  private params: SynthParams;
  private pitchBendCents = 0;
  private modWheelAmount = 0;

  /** The note currently held (or most recently released) - null only
   * before this voice has ever played a note. */
  note: string | null = null;
  private releasing = false;
  private releasedAt = -Infinity;
  private startedAt = -Infinity;

  constructor(params: SynthParams) {
    this.params = params;

    this.oscA = new Tone.FatOscillator({
      type: "custom",
      partials: wavetablePartialsAt(WAVETABLES[params.oscA.wavetable], params.oscA.position),
      count: params.oscA.unisonVoices,
      spread: params.oscA.unisonSpread,
    });
    this.oscB = new Tone.FatOscillator({
      type: "custom",
      partials: wavetablePartialsAt(WAVETABLES[params.oscB.wavetable], params.oscB.position),
      count: params.oscB.unisonVoices,
      spread: params.oscB.unisonSpread,
    });
    this.sub = new Tone.Oscillator({ type: "sine" });

    this.oscA.detune.value = staticTuningCents(params.oscA);
    this.oscB.detune.value = staticTuningCents(params.oscB);
    this.sub.detune.value = -1200 * params.subOctaveDown;

    this.oscAGain = new Tone.Gain(params.oscA.level);
    this.oscBGain = new Tone.Gain(params.oscBEnabled ? params.oscB.level : 0);
    this.subGain = new Tone.Gain(params.subLevel);

    this.filter = new Tone.Filter({ type: params.filterType, frequency: 0, Q: params.filterResonance });
    this.filterEnvelope = new Tone.FrequencyEnvelope({
      attack: params.filterAttack,
      decay: params.filterDecay,
      sustain: params.filterSustain,
      release: params.filterRelease,
      baseFrequency: Math.max(20, params.filterCutoff),
      octaves: params.filterEnvAmount,
    });
    this.ampEnvelope = new Tone.AmplitudeEnvelope({
      attack: params.ampAttack,
      decay: params.ampDecay,
      sustain: params.ampSustain,
      release: params.ampRelease,
    });
    this.lfo = new Tone.LFO({ frequency: params.lfoRate, min: 0, max: 0 }).start();
    this.output = new Tone.Gain(1);

    this.oscA.connect(this.oscAGain);
    this.oscB.connect(this.oscBGain);
    this.sub.connect(this.subGain);
    this.oscAGain.connect(this.filter);
    this.oscBGain.connect(this.filter);
    this.subGain.connect(this.filter);
    this.filterEnvelope.connect(this.filter.frequency);
    this.filter.connect(this.ampEnvelope);
    this.ampEnvelope.connect(this.output);

    this.applyLfoRouting();
    this.oscA.start();
    this.oscB.start();
    this.sub.start();
  }

  private applyLfoRouting(): void {
    this.lfo.disconnect();
    this.lfo.frequency.value = this.params.lfoRate;
    if (this.params.lfoTarget === "pitch") {
      const cents = this.params.lfoAmount * 100;
      this.lfo.min = -cents;
      this.lfo.max = cents;
      this.lfo.connect(this.oscA.detune);
      this.lfo.connect(this.oscB.detune);
      this.lfo.connect(this.sub.detune);
    } else {
      const range = this.params.lfoAmount * 3000;
      this.lfo.min = -range;
      this.lfo.max = range;
      this.lfo.connect(this.filter.frequency);
    }
  }

  /** A voice is reusable once idle, or once its release tail has had time
   * to fade out - avoids yanking a still-fading note out from under itself
   * when a new one needs a voice and none are fully idle. */
  isFree(now: number): boolean {
    if (this.note === null) return true;
    return this.releasing && now - this.releasedAt > this.params.ampRelease + 0.05;
  }

  /** How long ago this voice was last (re)triggered - the oldest-triggered
   * voice is stolen first when every voice is busy. */
  age(now: number): number {
    return now - this.startedAt;
  }

  triggerAttack(note: string, time: number, velocity: number): void {
    this.note = note;
    this.releasing = false;
    this.startedAt = time;
    const freq = noteToFrequency(note);
    this.oscA.frequency.setValueAtTime(freq, time);
    this.oscB.frequency.setValueAtTime(freq, time);
    this.sub.frequency.setValueAtTime(freq, time);
    this.filterEnvelope.triggerAttack(time);
    this.ampEnvelope.triggerAttack(time, velocity);
  }

  triggerRelease(time: number): void {
    this.releasing = true;
    this.releasedAt = time;
    this.filterEnvelope.triggerRelease(time);
    this.ampEnvelope.triggerRelease(time);
  }

  getLevel(time: number): number {
    return this.ampEnvelope.getValueAtTime(time);
  }

  setPitchBend(cents: number): void {
    this.pitchBendCents = cents;
    this.oscA.detune.value = staticTuningCents(this.params.oscA) + cents;
    this.oscB.detune.value = staticTuningCents(this.params.oscB) + cents;
    this.sub.detune.value = -1200 * this.params.subOctaveDown + cents;
  }

  setModWheel(amount: number): void {
    this.modWheelAmount = Math.max(0, Math.min(1, amount));
    this.filterEnvelope.baseFrequency = Math.max(20, this.params.filterCutoff) * (1 + this.modWheelAmount * 3);
  }

  applyParams(params: SynthParams): void {
    this.params = params;
    this.oscA.count = Math.max(1, Math.round(params.oscA.unisonVoices));
    this.oscA.spread = params.oscA.unisonSpread;
    this.oscA.partials = wavetablePartialsAt(WAVETABLES[params.oscA.wavetable], params.oscA.position);
    this.oscA.detune.value = staticTuningCents(params.oscA) + this.pitchBendCents;
    this.oscAGain.gain.value = params.oscA.level;

    this.oscB.count = Math.max(1, Math.round(params.oscB.unisonVoices));
    this.oscB.spread = params.oscB.unisonSpread;
    this.oscB.partials = wavetablePartialsAt(WAVETABLES[params.oscB.wavetable], params.oscB.position);
    this.oscB.detune.value = staticTuningCents(params.oscB) + this.pitchBendCents;
    this.oscBGain.gain.value = params.oscBEnabled ? params.oscB.level : 0;

    this.sub.detune.value = -1200 * params.subOctaveDown + this.pitchBendCents;
    this.subGain.gain.value = params.subLevel;

    this.filter.type = params.filterType;
    this.filter.Q.value = params.filterResonance;
    this.filterEnvelope.attack = params.filterAttack;
    this.filterEnvelope.decay = params.filterDecay;
    this.filterEnvelope.sustain = params.filterSustain;
    this.filterEnvelope.release = params.filterRelease;
    this.filterEnvelope.baseFrequency = Math.max(20, params.filterCutoff) * (1 + this.modWheelAmount * 3);
    this.filterEnvelope.octaves = params.filterEnvAmount;

    this.ampEnvelope.attack = params.ampAttack;
    this.ampEnvelope.decay = params.ampDecay;
    this.ampEnvelope.sustain = params.ampSustain;
    this.ampEnvelope.release = params.ampRelease;

    this.applyLfoRouting();
  }

  dispose(): void {
    this.oscA.dispose();
    this.oscB.dispose();
    this.sub.dispose();
    this.oscAGain.dispose();
    this.oscBGain.dispose();
    this.subGain.dispose();
    this.filter.dispose();
    this.filterEnvelope.dispose();
    this.ampEnvelope.dispose();
    this.lfo.dispose();
    this.output.dispose();
  }
}

export const WAVETABLE_OPTIONS = Object.values(WAVETABLES).map((t) => ({ value: t.name, label: t.label }));

function defaultOscillator(overrides: Partial<OscillatorParams> = {}): OscillatorParams {
  return {
    wavetable: "classic",
    position: 0.4,
    octave: 0,
    semitone: 0,
    fineCents: 0,
    level: 0.8,
    unisonVoices: 1,
    unisonSpread: 12,
    ...overrides,
  };
}

export const SYNTH_PRESETS: { name: string; params: SynthParams }[] = [
  {
    name: "Lead",
    params: {
      oscA: defaultOscillator({ wavetable: "classic", position: 0.6, unisonVoices: 3, unisonSpread: 18 }),
      oscB: defaultOscillator({ wavetable: "classic", position: 0.6, octave: 0, fineCents: 8, level: 0.5 }),
      oscBEnabled: true,
      subLevel: 0.15,
      subOctaveDown: 1,
      filterType: "lowpass",
      filterCutoff: 2600,
      filterResonance: 1.5,
      filterEnvAmount: 1.2,
      ampAttack: 0.01,
      ampDecay: 0.15,
      ampSustain: 0.7,
      ampRelease: 0.2,
      filterAttack: 0.01,
      filterDecay: 0.25,
      filterSustain: 0.4,
      filterRelease: 0.3,
      lfoRate: 5,
      lfoAmount: 0.05,
      lfoTarget: "pitch",
      glide: 0,
    },
  },
  {
    name: "Wavetable Pad",
    params: {
      oscA: defaultOscillator({ wavetable: "formant", position: 0.1, unisonVoices: 5, unisonSpread: 25, level: 0.7 }),
      oscB: defaultOscillator({ wavetable: "formant", position: 0.9, unisonVoices: 5, unisonSpread: 25, level: 0.6 }),
      oscBEnabled: true,
      subLevel: 0.2,
      subOctaveDown: 1,
      filterType: "lowpass",
      filterCutoff: 1200,
      filterResonance: 0.7,
      filterEnvAmount: 1.5,
      ampAttack: 0.7,
      ampDecay: 0.6,
      ampSustain: 0.8,
      ampRelease: 2.2,
      filterAttack: 1.4,
      filterDecay: 1,
      filterSustain: 0.5,
      filterRelease: 2,
      lfoRate: 0.4,
      lfoAmount: 0.3,
      lfoTarget: "filter",
      glide: 0,
    },
  },
  {
    name: "Sub Bass",
    params: {
      oscA: defaultOscillator({ wavetable: "classic", position: 0.75, unisonVoices: 2, unisonSpread: 8 }),
      oscB: defaultOscillator({ wavetable: "classic", position: 0.75, octave: -1, level: 0.4 }),
      oscBEnabled: true,
      subLevel: 0.6,
      subOctaveDown: 1,
      filterType: "lowpass",
      filterCutoff: 700,
      filterResonance: 2,
      filterEnvAmount: 0.8,
      ampAttack: 0.004,
      ampDecay: 0.2,
      ampSustain: 0.5,
      ampRelease: 0.12,
      filterAttack: 0.005,
      filterDecay: 0.15,
      filterSustain: 0.2,
      filterRelease: 0.15,
      lfoRate: 4,
      lfoAmount: 0,
      lfoTarget: "pitch",
      glide: 0,
    },
  },
  {
    name: "Pluck",
    params: {
      oscA: defaultOscillator({ wavetable: "organ", position: 0.3, unisonVoices: 1 }),
      oscB: defaultOscillator({ wavetable: "organ", position: 0.3, octave: 1, level: 0.3 }),
      oscBEnabled: true,
      subLevel: 0,
      subOctaveDown: 1,
      filterType: "lowpass",
      filterCutoff: 3200,
      filterResonance: 1,
      filterEnvAmount: -2.5,
      ampAttack: 0.001,
      ampDecay: 0.22,
      ampSustain: 0,
      ampRelease: 0.15,
      filterAttack: 0.001,
      filterDecay: 0.3,
      filterSustain: 0,
      filterRelease: 0.2,
      lfoRate: 5,
      lfoAmount: 0,
      lfoTarget: "pitch",
      glide: 0,
    },
  },
  {
    name: "Metallic Bell",
    params: {
      oscA: defaultOscillator({ wavetable: "metallic", position: 0.2, unisonVoices: 1 }),
      oscB: defaultOscillator({ wavetable: "metallic", position: 0.8, octave: 1, fineCents: -6, level: 0.5 }),
      oscBEnabled: true,
      subLevel: 0,
      subOctaveDown: 1,
      filterType: "lowpass",
      filterCutoff: 8000,
      filterResonance: 0.5,
      filterEnvAmount: -3,
      ampAttack: 0.004,
      ampDecay: 1.4,
      ampSustain: 0.05,
      ampRelease: 1.4,
      filterAttack: 0.004,
      filterDecay: 1.6,
      filterSustain: 0,
      filterRelease: 1.6,
      lfoRate: 3,
      lfoAmount: 0,
      lfoTarget: "pitch",
      glide: 0,
    },
  },
  {
    name: "Glitch Stab",
    params: {
      oscA: defaultOscillator({ wavetable: "glitch", position: 0.3, unisonVoices: 4, unisonSpread: 35 }),
      oscB: defaultOscillator({ wavetable: "glitch", position: 0.8, octave: 0, level: 0.4 }),
      oscBEnabled: true,
      subLevel: 0.25,
      subOctaveDown: 1,
      filterType: "bandpass",
      filterCutoff: 1800,
      filterResonance: 3,
      filterEnvAmount: 2,
      ampAttack: 0.001,
      ampDecay: 0.12,
      ampSustain: 0.2,
      ampRelease: 0.1,
      filterAttack: 0.001,
      filterDecay: 0.2,
      filterSustain: 0.1,
      filterRelease: 0.15,
      lfoRate: 7,
      lfoAmount: 0.4,
      lfoTarget: "filter",
      glide: 0,
    },
  },
];

export function defaultSynthParams(): SynthParams {
  return structuredClone(SYNTH_PRESETS[0].params);
}

/**
 * A polyphonic wavetable synth: two independently-tuned wavetable
 * oscillators (each with its own unison stack) plus a sub oscillator, all
 * mixed into a resonant filter with its own envelope, then an amplitude
 * envelope, per voice - with a shared LFO routable to pitch or the filter.
 * Implements the same `Instrument` surface as the Sampler/DrumKit so the
 * engine can swap it in wherever those go.
 */
export class SynthInstrument implements Instrument {
  private output = new Tone.Gain(1);
  private voices: Voice[] = [];
  private params: SynthParams;
  private pitchBendCents = 0;
  private modWheelAmount = 0;

  constructor(params: SynthParams) {
    this.params = params;
    for (let i = 0; i < MAX_POLYPHONY; i++) {
      const voice = new Voice(params);
      voice.output.connect(this.output);
      this.voices.push(voice);
    }
  }

  private allocateVoice(time: number): Voice {
    const free = this.voices.find((v) => v.isFree(time));
    if (free) return free;
    // Every voice is busy - steal the one that's been sounding longest.
    return this.voices.reduce((oldest, v) => (v.age(time) > oldest.age(time) ? v : oldest));
  }

  setParams(params: SynthParams): void {
    this.params = params;
    this.voices.forEach((v) => v.applyParams(params));
  }

  setDetune(cents: number): void {
    this.pitchBendCents = cents;
    this.voices.forEach((v) => v.setPitchBend(cents));
  }

  setModWheel(amount: number): void {
    this.modWheelAmount = amount;
    this.voices.forEach((v) => v.setModWheel(amount));
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
    const seconds = time !== undefined ? Tone.Time(time).toSeconds() : Tone.now();
    this.allocateVoice(seconds).triggerAttack(note, seconds, velocity);
  }

  triggerRelease(note: string, time?: Tone.Unit.Time): void {
    const seconds = time !== undefined ? Tone.Time(time).toSeconds() : Tone.now();
    this.voices.filter((v) => v.note === note && !v.isFree(seconds)).forEach((v) => v.triggerRelease(seconds));
  }

  triggerAttackRelease(
    note: string,
    duration: Tone.Unit.Time,
    time?: Tone.Unit.Time,
    velocity = 0.8
  ): void {
    const seconds = time !== undefined ? Tone.Time(time).toSeconds() : Tone.now();
    const durationSeconds = Tone.Time(duration).toSeconds();
    const voice = this.allocateVoice(seconds);
    voice.triggerAttack(note, seconds, velocity);
    voice.triggerRelease(seconds + durationSeconds);
  }

  releaseAll(time?: Tone.Unit.Time): void {
    const seconds = time !== undefined ? Tone.Time(time).toSeconds() : Tone.now();
    this.voices.forEach((v) => {
      if (!v.isFree(seconds)) v.triggerRelease(seconds);
    });
  }

  dispose(): void {
    this.voices.forEach((v) => v.dispose());
    this.output.dispose();
  }
}
