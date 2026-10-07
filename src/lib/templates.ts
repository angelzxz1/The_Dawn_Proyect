// Project templates for the start screen: ordinary projects, built here
// from the groove library, the factory kits, synth presets, effect chains
// and Dawn's cabinets, then run through normalizeProject like any project
// that's opened. Each makes sound within a click or two (press Play, or
// arm and record).

import { chainById } from "../effects/chains";
import { FACTORY_KITS } from "./drumKits";
import { defaultParams, type EffectInstance, type EffectType } from "../effects/registry";
import { grooveBeats, grooveById, grooveNotes } from "./grooves";
import { midiToNoteName } from "./piano";
import { findPreset, paramsFromPreset } from "../effects/presets";
import { normalizeProject, type SerializedProject } from "./projectSchema";
import { FACTORY_SYNTH_PRESETS } from "./synthPresets";
import type { ChannelConfig, NoteEvent } from "./types";

export type TemplateId = "guitar-demo" | "beat" | "voice-guitar" | "empty";

export interface ProjectTemplate {
  id: TemplateId;
  name: string;
  description: string;
  /** What's in it, for the card. */
  contents: string[];
  build: () => SerializedProject;
}

// --- builders (ids follow the app's ch-/clip-/fx-/bus- patterns, so new
// ones made after loading never collide) ---

class Builder {
  private fxN = 0;
  private clipN = 0;
  readonly channels: ChannelConfig[] = [];
  readonly channelEffects: Record<string, EffectInstance[]> = {};
  readonly clipsByChannel: Record<string, unknown[]> = {};
  readonly buses: { id: string; name: string; colorIndex: number }[] = [];
  readonly busEffects: Record<string, EffectInstance[]> = {};

  constructor(readonly bpm: number, readonly beatsPerBar = 4) {}

  get spb() {
    return 60 / this.bpm;
  }
  bars(n: number) {
    return n * this.beatsPerBar * this.spb;
  }

  fx(type: EffectType, presetId?: string, params: Record<string, number> = {}): EffectInstance {
    const preset = findPreset(presetId);
    const base = preset && preset.type === type ? paramsFromPreset(preset, defaultParams(type), this.bpm) : defaultParams(type);
    return {
      id: `fx-${++this.fxN}`,
      type,
      params: { ...base, ...params },
      bypass: false,
      ...(preset && preset.type === type ? { preset: { id: preset.id, name: preset.name } } : {}),
    };
  }

  /** A chain's effects, optionally leaving out some types (a reverb that a send replaces). */
  chain(id: string, skip: EffectType[] = []): EffectInstance[] {
    const chain = chainById(id);
    if (!chain) return [];
    return chain.steps
      .filter((s) => !skip.includes(s.type))
      .map((s) => ({ ...this.fx(s.type, s.preset, s.params), ...(s.file ? { file: s.file } : {}) }));
  }

  track(name: string, type: "midi" | "audio", extra: Partial<ChannelConfig> = {}, effects: EffectInstance[] = []): string {
    const id = `ch-${this.channels.length + 1}`;
    this.channels.push({ id, name, volume: 0, pan: 0, colorIndex: this.channels.length, type, instrument: null, muted: false, solo: false, armed: false, ...extra });
    this.channelEffects[id] = effects;
    this.clipsByChannel[id] = [];
    return id;
  }

  bus(name: string, effects: EffectInstance[]): string {
    const id = `bus-${this.buses.length + 1}`;
    this.buses.push({ id, name, colorIndex: this.buses.length });
    this.busEffects[id] = effects;
    return id;
  }

  send(channelId: string, busId: string, db: number) {
    const ch = this.channels.find((c) => c.id === channelId)!;
    ch.sends = { ...(ch.sends ?? {}), [busId]: db };
  }

  /** A clip at `bar` (1-based) lasting `lengthBars`, its notes repeating
   * every `loopBars` when that's shorter. */
  clip(channelId: string, bar: number, lengthBars: number, notes: NoteEvent[], loopBars?: number) {
    this.clipsByChannel[channelId].push({
      id: `clip-${++this.clipN}`,
      kind: "midi",
      offset: this.bars(bar - 1),
      length: this.bars(lengthBars),
      notes,
      loopLength: loopBars && loopBars < lengthBars ? this.bars(loopBars) : null,
    });
  }

  /** A groove from the library at `bar`, looped to fill `lengthBars`. */
  groove(channelId: string, grooveId: string, bar: number, lengthBars?: number) {
    const g = grooveById(grooveId);
    if (!g) throw new Error(`No groove ${grooveId}`);
    const bars = grooveBeats(g) / this.beatsPerBar;
    this.clip(channelId, bar, lengthBars ?? bars, grooveNotes(g, this.bpm), bars);
  }

  project(extra: Record<string, unknown> = {}): SerializedProject {
    const project = normalizeProject({
      channels: this.channels,
      channelEffects: this.channelEffects,
      clipsByChannel: this.clipsByChannel,
      buses: this.buses,
      busEffects: this.busEffects,
      bpm: this.bpm,
      ...extra,
    });
    if (!project) throw new Error("Template didn't build");
    return project;
  }
}

const kit = (name: string) => structuredClone((FACTORY_KITS.find((k) => k.name === name) ?? FACTORY_KITS[0]).kit);
const synth = (name: string) => structuredClone((FACTORY_SYNTH_PRESETS.find((p) => p.name === name) ?? FACTORY_SYNTH_PRESETS[0]).params);

/** Notes from [midi, startBeat, beats, velocity] at a tempo. */
function notes(spb: number, list: [number, number, number, number?][]): NoteEvent[] {
  return list.map(([midi, start, beats, vel = 0.8]) => ({ note: midiToNoteName(midi), time: start * spb, duration: beats * spb * 0.98, velocity: vel }));
}

// A minor - F - C - G, two bars per chord (8 bars).
const PROGRESSION = [
  { root: 45, chord: [57, 60, 64] }, // Am
  { root: 41, chord: [53, 57, 60] }, // F
  { root: 48, chord: [55, 60, 64] }, // C
  { root: 43, chord: [55, 59, 62] }, // G
];

function guitarDemo(): SerializedProject {
  const b = new Builder(110);
  const drums = b.track("Drums", "midi", { instrument: "drums", drumParams: kit("Rock Kit") });
  b.groove(drums, "rock-intro", 1);
  b.groove(drums, "rock-verse", 3, 8);
  b.groove(drums, "rock-fill", 11);
  b.groove(drums, "rock-chorus", 12, 8);
  b.groove(drums, "rock-ending", 20);
  const guitar = b.track("Guitar", "audio", { armed: true }, b.chain("crunch-guitar", ["reverb"]));
  const bass = b.track("Bass", "audio", { volume: -2 }, b.chain("bass-di"));
  const reverb = b.bus("Reverb", [b.fx("reverb", "factory:reverb:small-room", { wet: 1 })]);
  b.send(guitar, reverb, -14);
  b.send(drums, reverb, -22);
  void bass;
  return b.project({ metronomeEnabled: true, countInBars: 1 });
}

function beat(): SerializedProject {
  const b = new Builder(140);
  const spb = b.spb;
  const drums = b.track("808 Drums", "midi", { instrument: "drums", drumParams: kit("Trap"), volume: -5 });
  b.groove(drums, "trap-intro", 1);
  b.groove(drums, "trap-verse", 3, 8);
  b.groove(drums, "trap-chorus", 11, 8);
  // Bass: the roots, ducking under the kick through a sidechained compressor.
  const pump = b.fx("compressor", "factory:compressor:sidechain-pump", { scLpf: 200 });
  pump.sidechain = { on: true, source: drums, tap: "postFx" };
  const bass = b.track("Bass", "midi", { instrument: "synth", synthParams: synth("Dawn Sub"), volume: -8 }, [pump]);
  const bassLine = PROGRESSION.flatMap((c, i) => [
    [c.root - 12, i * 8, 3, 0.9],
    [c.root - 12, i * 8 + 3.5, 0.5, 0.7],
    [c.root - 12, i * 8 + 4, 3.5, 0.85],
  ]) as [number, number, number, number][];
  b.clip(bass, 3, 16, notes(spb, bassLine), 8);
  // Pad: the chords.
  const pad = b.track("Pad", "midi", { instrument: "synth", synthParams: synth("Sunrise Pad"), volume: -15 });
  b.clip(pad, 3, 16, notes(spb, PROGRESSION.flatMap((c, i) => c.chord.map((n) => [n, i * 8, 8, 0.6] as [number, number, number, number]))), 8);
  // Lead: a hook in the chorus.
  const lead = b.track("Lead", "midi", { instrument: "synth", synthParams: synth("Pulse Lead"), volume: -14 });
  const hook: [number, number, number, number?][] = [
    [76, 0, 1], [74, 1, 0.5], [72, 1.5, 1.5], [69, 4, 2],
    [72, 8, 1], [71, 9, 0.5], [69, 9.5, 1.5], [65, 12, 2],
    [67, 16, 1], [69, 17, 0.5], [72, 17.5, 1.5], [76, 20, 2],
    [74, 24, 1.5], [72, 25.5, 0.5], [71, 26, 2], [67, 28, 3],
  ];
  b.clip(lead, 11, 8, notes(spb, hook));
  const reverb = b.bus("Reverb", [b.fx("reverb", "factory:reverb:big-hall", { wet: 1 })]);
  b.send(pad, reverb, -10);
  b.send(lead, reverb, -12);
  // The loop covers the verse (bars 3-10).
  return b.project({ loop: { on: true, start: 8, end: 8 + 32 } });
}

function voiceGuitar(): SerializedProject {
  const b = new Builder(90);
  const vocal = b.track("Vocal", "audio", { armed: true }, b.chain("vocal", ["reverb"]));
  const guitar = b.track("Acoustic Guitar", "audio", {}, b.chain("acoustic-guitar", ["reverb"]));
  const reverb = b.bus("Reverb", [b.fx("reverb", "factory:reverb:vocal-plate", { wet: 1 })]);
  b.send(vocal, reverb, -12);
  b.send(guitar, reverb, -16);
  return b.project({ metronomeEnabled: true, countInBars: 1 });
}

function empty(): SerializedProject {
  const b = new Builder(120);
  b.track("MIDI 1", "midi");
  b.track("MIDI 2", "midi");
  b.track("Audio 1", "audio");
  return b.project();
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "guitar-demo",
    name: "Guitar Demo",
    description: "Record a riff over a rock groove.",
    contents: ["Drums with a 20-bar rock arrangement", "Guitar track, armed, with a crunch amp chain", "Bass track", "Reverb bus · metronome · 1-bar count-in"],
    build: guitarDemo,
  },
  {
    id: "beat",
    name: "Beat",
    description: "A trap beat with an 808, ready to build on.",
    contents: ["808 drums, intro to chorus", "Sub bass ducking under the kick (sidechain)", "Pad chords and a lead hook", "Reverb bus · loop on"],
    build: beat,
  },
  {
    id: "voice-guitar",
    name: "Voice + Guitar",
    description: "Sing and play: two tracks with vocal and acoustic chains.",
    contents: ["Vocal track, armed: gate, compressor, EQ", "Acoustic guitar track", "Plate reverb bus · metronome · count-in"],
    build: voiceGuitar,
  },
  {
    id: "empty",
    name: "Empty Project",
    description: "Two MIDI tracks and an audio track. Start from scratch.",
    contents: ["MIDI 1, MIDI 2, Audio 1"],
    build: empty,
  },
];

export function templateById(id: string): ProjectTemplate | undefined {
  return PROJECT_TEMPLATES.find((t) => t.id === id);
}
