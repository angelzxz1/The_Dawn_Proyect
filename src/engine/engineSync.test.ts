import { describe, expect, it } from "vitest";
import { hydrateEngine, syncEngine, type EngineApi } from "./engineSync";
import type { EffectInstance, EffectType } from "../effects/registry";
import type { ProjectState } from "../project/project";
import type { AudioClipInstance, ChannelConfig, ChannelType, InstrumentType, MidiClipInstance, NoteEvent } from "../project/types";

// A stand-in for the audio engine that keeps what the real one would hold
// (tracks, chains in order with their params, sends, clips, buses, master)
// and counts the calls made to it.
interface FakeFx {
  id: string;
  type: EffectType;
  params: Record<string, number>;
  bypass: boolean;
  file: string | null;
  sidechain: unknown;
}
interface FakeTrack {
  type: ChannelType;
  instrument: InstrumentType | null;
  synth: unknown;
  drums: unknown;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  effects: FakeFx[];
  sends: Record<string, number>;
  automation: unknown;
  notes: NoteEvent[];
  clips: Record<string, { url: string; timing: unknown; gain: number }>;
}

class FakeEngine {
  calls: string[] = [];
  tracks = new Map<string, FakeTrack>();
  buses = new Map<string, { effects: FakeFx[] }>();
  master = { volume: 0, pan: 0, effects: [] as FakeFx[] };
  tempo = { bpm: 0, beatsPerBar: 0 };

  private log(name: string) {
    this.calls.push(name);
  }
  private chain(id: string): FakeFx[] | undefined {
    if (id === "master") return this.master.effects;
    return this.tracks.get(id)?.effects ?? this.buses.get(id)?.effects;
  }
  private fx(host: string, id: string) {
    return this.chain(host)?.find((e) => e.id === id);
  }
  /** What the engine holds, for comparing two engines. */
  snapshot() {
    const sorted = <T>(m: Map<string, T>) => Object.fromEntries([...m.entries()].sort(([a], [b]) => a.localeCompare(b)));
    return JSON.parse(JSON.stringify({ tracks: sorted(this.tracks), buses: sorted(this.buses), master: this.master, tempo: this.tempo }));
  }

  addChannel(id: string, type: ChannelType, instrument: InstrumentType | null, synth?: unknown, drums?: unknown) {
    this.log("addChannel");
    if (this.tracks.has(id)) return;
    this.tracks.set(id, {
      type,
      instrument: type === "midi" ? instrument : null,
      synth: synth ?? null,
      drums: drums ?? null,
      volume: 0,
      pan: 0,
      muted: false,
      solo: false,
      effects: [],
      sends: {},
      automation: [],
      notes: [],
      clips: {},
    });
  }
  removeChannel(id: string) {
    this.log("removeChannel");
    this.tracks.delete(id);
  }
  setInstrument(id: string, type: InstrumentType | null, synth?: unknown, drums?: unknown) {
    this.log("setInstrument");
    const t = this.tracks.get(id);
    if (!t || t.type !== "midi" || t.instrument === type) return;
    Object.assign(t, { instrument: type, synth: synth ?? null, drums: drums ?? null });
  }
  setSynthParams(id: string, params: unknown) {
    this.log("setSynthParams");
    const t = this.tracks.get(id);
    if (t?.instrument === "synth") t.synth = params;
  }
  setDrumKit(id: string, kit: unknown) {
    this.log("setDrumKit");
    const t = this.tracks.get(id);
    if (t?.instrument === "drums") t.drums = kit;
  }
  setVolume(id: string, db: number) {
    this.log("setVolume");
    const t = this.tracks.get(id);
    if (t) t.volume = db;
  }
  setPan(id: string, pan: number) {
    this.log("setPan");
    const t = this.tracks.get(id);
    if (t) t.pan = pan;
  }
  setMute(id: string, muted: boolean) {
    this.log("setMute");
    const t = this.tracks.get(id);
    if (t) t.muted = muted;
  }
  setSolo(id: string, solo: boolean) {
    this.log("setSolo");
    const t = this.tracks.get(id);
    if (t) t.solo = solo;
  }
  setSend(id: string, busId: string, db: number | null) {
    this.log("setSend");
    const t = this.tracks.get(id);
    if (!t) return;
    if (db === null) delete t.sends[busId];
    else t.sends[busId] = db;
  }
  setAutomation(id: string, lanes: unknown) {
    this.log("setAutomation");
    const t = this.tracks.get(id);
    if (t) t.automation = lanes;
  }
  setClip(id: string, notes: NoteEvent[]) {
    this.log("setClip");
    const t = this.tracks.get(id);
    if (t) t.notes = notes;
  }
  loadAudioClip(id: string, clipId: string, url: string, timing: unknown, gain = 0) {
    this.log("loadAudioClip");
    const t = this.tracks.get(id);
    if (t?.type === "audio") t.clips[clipId] = { url, timing, gain };
  }
  moveAudioClip(id: string, clipId: string, timing: unknown) {
    this.log("moveAudioClip");
    const c = this.tracks.get(id)?.clips[clipId];
    if (c) c.timing = timing;
  }
  setAudioClipGain(id: string, clipId: string, gain: number) {
    this.log("setAudioClipGain");
    const c = this.tracks.get(id)?.clips[clipId];
    if (c) c.gain = gain;
  }
  removeAudioClip(id: string, clipId: string) {
    this.log("removeAudioClip");
    const t = this.tracks.get(id);
    if (t) delete t.clips[clipId];
  }
  addBus(id: string) {
    this.log("addBus");
    if (!this.buses.has(id)) this.buses.set(id, { effects: [] });
  }
  removeBus(id: string) {
    this.log("removeBus");
    this.buses.delete(id);
    this.tracks.forEach((t) => delete t.sends[id]);
  }
  resetEffects(id: string) {
    this.log("resetEffects");
    this.chain(id)?.splice(0);
  }
  addEffect(host: string, type: EffectType, id?: string, atIndex?: number) {
    this.log("addEffect");
    const chain = this.chain(host);
    if (!chain || !id) return null;
    const fx: FakeFx = { id, type, params: {}, bypass: false, file: null, sidechain: null };
    if (atIndex !== undefined && atIndex >= 0 && atIndex <= chain.length) chain.splice(atIndex, 0, fx);
    else chain.push(fx);
    return { id, type, params: {}, bypass: false };
  }
  removeEffect(host: string, id: string) {
    this.log("removeEffect");
    const chain = this.chain(host);
    const i = chain?.findIndex((e) => e.id === id) ?? -1;
    if (i >= 0) chain!.splice(i, 1);
  }
  moveEffect(host: string, id: string, to: number) {
    this.log("moveEffect");
    const chain = this.chain(host);
    const i = chain?.findIndex((e) => e.id === id) ?? -1;
    if (i < 0) return;
    const [fx] = chain!.splice(i, 1);
    chain!.splice(Math.max(0, Math.min(chain!.length, to)), 0, fx);
  }
  setEffectParam(host: string, id: string, key: string, value: number) {
    this.log("setEffectParam");
    const fx = this.fx(host, id);
    if (fx) fx.params[key] = value;
  }
  setEffectBypass(host: string, id: string, bypass: boolean) {
    this.log("setEffectBypass");
    const fx = this.fx(host, id);
    if (fx) fx.bypass = bypass;
  }
  async setEffectFile(host: string, id: string, file: string | null) {
    this.log("setEffectFile");
    const fx = this.fx(host, id);
    if (fx) fx.file = file;
    return null;
  }
  setEffectSidechain(host: string, id: string, routing: unknown) {
    this.log("setEffectSidechain");
    const fx = this.fx(host, id);
    if (fx) fx.sidechain = routing ?? null;
  }
  setMasterVolume(db: number) {
    this.log("setMasterVolume");
    this.master.volume = db;
  }
  setMasterPan(pan: number) {
    this.log("setMasterPan");
    this.master.pan = pan;
  }
  setBpm(bpm: number) {
    this.log("setBpm");
    this.tempo.bpm = bpm;
  }
  setTimeSignature(beatsPerBar: number) {
    this.log("setTimeSignature");
    this.tempo.beatsPerBar = beatsPerBar;
  }
}

const api = (e: FakeEngine) => e as unknown as EngineApi;

// --- A small project, and edits to it ---

const track = (id: string, type: ChannelType, extra: Partial<ChannelConfig> = {}): ChannelConfig => ({
  id,
  name: id,
  volume: 0,
  pan: 0,
  colorIndex: 0,
  type,
  instrument: type === "midi" ? "piano" : null,
  muted: false,
  solo: false,
  armed: false,
  ...extra,
});
const fx = (id: string, type: EffectType, params: Record<string, number> = { mix: 0.5 }, extra: Partial<EffectInstance> = {}): EffectInstance => ({
  id,
  type,
  params,
  ...extra,
});
const midiClip = (id: string, offset: number): MidiClipInstance => ({
  id,
  kind: "midi",
  offset,
  length: 2,
  notes: [{ note: "C4", time: 0, duration: 0.5, velocity: 0.8 }],
  loopLength: null,
});
const audioClip = (id: string, offset: number, url = `blob:${id}`): AudioClipInstance => ({
  id,
  kind: "audio",
  offset,
  length: 1,
  url,
  fileName: `${id}.wav`,
  durationSeconds: 1,
  peaks: [],
  sourceOffset: 0,
  fadeIn: 0,
  fadeOut: 0,
  gainDb: 0,
  loopLength: null,
});

function base(): ProjectState {
  return {
    channels: [
      track("ch-1", "midi", { sends: { "bus-1": -6 } }),
      track("ch-2", "audio"),
      track("ch-3", "midi", { instrument: "drums", drumParams: { kit: "a" } as never }),
    ],
    clipsByChannel: { "ch-1": [midiClip("clip-1", 0)], "ch-2": [audioClip("clip-2", 0), audioClip("clip-3", 2)] },
    channelEffects: {
      "ch-1": [fx("fx-1", "reverb"), fx("fx-2", "delay"), fx("fx-3", "compressor")],
      "ch-2": [fx("fx-4", "namAmp", { gain: 1 }, { file: { id: "file-1" } as never }), fx("fx-5", "irLoader", { mix: 1 }, { file: { id: "file-2" } as never })],
    },
    buses: [{ id: "bus-1", name: "Bus 1", colorIndex: 0 }],
    busEffects: { "bus-1": [fx("fx-6", "reverb")] },
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    masterVolume: 0,
    masterPan: 0,
    masterName: "Master",
    masterEffects: [fx("fx-7", "limiter"), fx("fx-8", "eq3")],
  };
}

type Edit = (s: ProjectState) => ProjectState;
const onTrack = (s: ProjectState, id: string, change: (c: ChannelConfig) => ChannelConfig): ProjectState => ({
  ...s,
  channels: s.channels.map((c) => (c.id === id ? change(c) : c)),
});
const onChain = (s: ProjectState, id: string, change: (l: EffectInstance[]) => EffectInstance[]): ProjectState => ({
  ...s,
  channelEffects: { ...s.channelEffects, [id]: change(s.channelEffects[id] ?? []) },
});
const onClips = (s: ProjectState, id: string, change: (l: AudioClipInstance[]) => AudioClipInstance[]): ProjectState => ({
  ...s,
  clipsByChannel: { ...s.clipsByChannel, [id]: change(s.clipsByChannel[id] as AudioClipInstance[]) },
});

const edits: Record<string, Edit> = {
  "a knob": (s) => onChain(s, "ch-1", (l) => l.map((e) => (e.id === "fx-2" ? { ...e, params: { ...e.params, mix: 0.9 } } : e))),
  "add an effect in the middle": (s) => onChain(s, "ch-1", (l) => [l[0], fx("fx-9", "chorus"), ...l.slice(1)]),
  "remove an effect": (s) => onChain(s, "ch-1", (l) => l.filter((e) => e.id !== "fx-2")),
  "reorder a chain": (s) => onChain(s, "ch-1", (l) => [l[2], l[0], l[1]]),
  "bypass": (s) => onChain(s, "ch-1", (l) => l.map((e) => (e.id === "fx-3" ? { ...e, bypass: true } : e))),
  "swap an IR file": (s) => onChain(s, "ch-2", (l) => l.map((e) => (e.id === "fx-5" ? { ...e, file: { id: "file-3" } as never } : e))),
  "sidechain": (s) => onChain(s, "ch-1", (l) => l.map((e) => (e.id === "fx-3" ? { ...e, sidechain: { source: "ch-3", tap: "postFx" } as never } : e))),
  "add a track": (s) => ({ ...s, channels: [...s.channels, track("ch-4", "audio")], clipsByChannel: { ...s.clipsByChannel, "ch-4": [audioClip("clip-4", 1)] } }),
  "remove a track": (s) => ({ ...s, channels: s.channels.filter((c) => c.id !== "ch-2") }),
  "fader, pan, mute, solo": (s) => onTrack(s, "ch-1", (c) => ({ ...c, volume: -3, pan: 0.5, muted: true, solo: true })),
  "change instrument": (s) => onTrack(s, "ch-1", (c) => ({ ...c, instrument: "synth", synthParams: { a: 1 } as never })),
  "tweak the kit": (s) => onTrack(s, "ch-3", (c) => ({ ...c, drumParams: { kit: "b" } as never })),
  "sends": (s) => onTrack(s, "ch-1", (c) => ({ ...c, sends: {} })),
  "move and trim an audio clip": (s) => onClips(s, "ch-2", (l) => l.map((c) => (c.id === "clip-3" ? { ...c, offset: 3, length: 0.5, gainDb: -4 } : c))),
  "replace a clip's audio": (s) => onClips(s, "ch-2", (l) => l.map((c) => (c.id === "clip-2" ? { ...c, url: "blob:other" } : c))),
  "delete an audio clip": (s) => onClips(s, "ch-2", (l) => l.slice(1)),
  "move a MIDI clip": (s) => ({ ...s, clipsByChannel: { ...s.clipsByChannel, "ch-1": [midiClip("clip-1", 4)] } }),
  "add a bus": (s) => ({ ...s, buses: [...s.buses, { id: "bus-2", name: "Bus 2", colorIndex: 1 }], busEffects: { ...s.busEffects, "bus-2": [fx("fx-10", "delay")] } }),
  "remove a bus": (s) => ({ ...s, buses: [], busEffects: {}, channels: s.channels.map((c) => ({ ...c, sends: {} })) }),
  "master": (s) => ({ ...s, masterVolume: -2, masterEffects: [s.masterEffects[1], fx("fx-11", "distortion")] }),
  "tempo": (s) => ({ ...s, bpm: 90 }),
};

function built(state: ProjectState): FakeEngine {
  const engine = new FakeEngine();
  hydrateEngine(state, new Set(), api(engine));
  return engine;
}

describe("syncEngine", () => {
  for (const [name, edit] of Object.entries(edits)) {
    it(`ends where a full rebuild would: ${name} (undo and redo)`, () => {
      const before = base();
      const after = edit(before);
      const engine = built(before);
      const ids = new Set(before.channels.map((c) => c.id));
      syncEngine(before, after, ids, api(engine)); // redo
      expect(engine.snapshot()).toEqual(built(after).snapshot());
      expect([...ids].sort()).toEqual(after.channels.map((c) => c.id).sort());
      syncEngine(after, before, ids, api(engine)); // undo
      expect(engine.snapshot()).toEqual(built(before).snapshot());
    });
  }

  it("leaves the tracks and their effects alone when only a knob changed", () => {
    const before = base();
    const engine = built(before);
    engine.calls = [];
    syncEngine(before, edits["a knob"](before), new Set(before.channels.map((c) => c.id)), api(engine));
    expect(engine.calls).toEqual(["setEffectParam"]);
  });

  it("keeps an amp model and an IR loaded when another track changes", () => {
    const before = base();
    const engine = built(before);
    engine.calls = [];
    syncEngine(before, edits["add a track"](before), new Set(before.channels.map((c) => c.id)), api(engine));
    expect(engine.calls).not.toContain("removeChannel");
    expect(engine.calls).not.toContain("setEffectFile");
    expect(engine.calls.filter((c) => c === "addChannel")).toHaveLength(1);
  });

  it("moves an effect instead of rebuilding the chain", () => {
    const before = base();
    const engine = built(before);
    engine.calls = [];
    syncEngine(before, edits["reorder a chain"](before), new Set(before.channels.map((c) => c.id)), api(engine));
    expect(engine.calls.every((c) => c === "moveEffect")).toBe(true);
  });

  it("does nothing between identical versions", () => {
    const before = base();
    const engine = built(before);
    engine.calls = [];
    syncEngine(before, before, new Set(before.channels.map((c) => c.id)), api(engine));
    syncEngine(before, { ...before }, new Set(before.channels.map((c) => c.id)), api(engine));
    expect(engine.calls).toEqual([]);
  });
});
