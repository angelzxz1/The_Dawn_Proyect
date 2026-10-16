// Regression check for loading saved projects. Every file in
// __fixtures__/saved-projects is a project in the shape some earlier
// version of the app saved it; each must come out as a complete,
// current-version project. If a saved project ever breaks the app again,
// drop a copy of it in that folder so it stays fixed.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EFFECT_TYPES, FILE_EFFECT_TYPES, paramSpecs, type EffectInstance } from "../effects/registry";
import { PROJECT_VERSION, normalizeProject, type SerializedProject } from "./projectSchema";
import { SCALE_NAMES, SCALE_ROOTS } from "./scales";
import { SNAP_RESOLUTIONS } from "./musicTime";
import { WAVETABLE_IDS } from "../instruments/synth/wavetableModel";
import { initSynthParams } from "../instruments/synth/synthParams";

const FIXTURE_DIR = join(__dirname, "__fixtures__", "saved-projects");
const fixtures = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((name) => ({ name, raw: JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as unknown }));

const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/** Everything the UI and the engine take for granted about a project. */
function expectValidProject(p: SerializedProject) {
  expect(p.version).toBe(PROJECT_VERSION);
  expect(finite(p.bpm) && p.bpm >= 20 && p.bpm <= 300).toBe(true);
  expect([1, 2, 4, 8, 16]).toContain(p.timeSignature.denominator);
  expect(Number.isInteger(p.timeSignature.numerator)).toBe(true);
  expect(SCALE_ROOTS).toContain(p.scaleSetting.root);
  expect(SCALE_NAMES).toContain(p.scaleSetting.scale);
  expect(SNAP_RESOLUTIONS).toContain(p.snapResolution);
  expect(typeof p.masterName).toBe("string");
  [p.masterVolume, p.masterPan, p.masterLimiterThreshold, p.countInBars].forEach((v) => expect(finite(v)).toBe(true));

  const effectIds = new Set<string>();
  const checkEffects = (list: EffectInstance[]) => {
    expect(Array.isArray(list)).toBe(true);
    list.forEach((fx) => {
      expect(effectIds.has(fx.id)).toBe(false);
      effectIds.add(fx.id);
      expect(EFFECT_TYPES).toContain(fx.type);
      expect(typeof fx.bypass).toBe("boolean");
      if (fx.file) {
        expect(FILE_EFFECT_TYPES).toContain(fx.type);
        expect(typeof fx.file.id).toBe("string");
        expect(typeof fx.file.name).toBe("string");
      }
      const specs = paramSpecs(fx.type);
      expect(Object.keys(fx.params).sort()).toEqual(specs.map((s) => s.key).sort());
      specs.forEach((s) => {
        const v = fx.params[s.key];
        expect(finite(v) && v >= s.min && v <= s.max, `${fx.type}.${s.key} = ${v}`).toBe(true);
      });
    });
  };

  const busIds = new Set(p.buses.map((b) => b.id));
  expect(busIds.size).toBe(p.buses.length);
  p.buses.forEach((b) => checkEffects(p.busEffects[b.id]));
  checkEffects(p.masterEffects);

  const channelIds = new Set(p.channels.map((c) => c.id));
  expect(channelIds.size).toBe(p.channels.length);
  const clipIds = new Set<string>();
  p.channels.forEach((c) => {
    expect(["midi", "audio"]).toContain(c.type);
    [c.volume, c.pan, c.colorIndex].forEach((v) => expect(finite(v)).toBe(true));
    if (c.type === "audio") expect(c.instrument).toBeNull();
    expect(c.synthParams !== undefined).toBe(c.instrument === "synth");
    if (c.synthParams) {
      // `preset` (the name it was loaded as) is optional.
      const keys = (o: object) => Object.keys(o).filter((k) => k !== "preset").sort();
      expect(keys(c.synthParams)).toEqual(keys(initSynthParams()));
      expect(WAVETABLE_IDS).toContain(c.synthParams.osc1.table);
      expect(WAVETABLE_IDS).toContain(c.synthParams.osc2.table);
    }
    Object.keys(c.sends ?? {}).forEach((busId) => expect(busIds.has(busId)).toBe(true));

    const effects = p.channelEffects[c.id];
    checkEffects(effects);
    (c.automationLanes ?? []).forEach((lane) => {
      if (lane.target.kind === "effect") {
        const { effectId, paramKey } = lane.target;
        const fx = effects.find((e) => e.id === effectId);
        expect(fx, `lane ${lane.id} targets a missing effect`).toBeDefined();
        expect(paramSpecs(fx!.type).map((s) => s.key)).toContain(paramKey);
      }
      lane.points.forEach((pt, i) => {
        expect(finite(pt.time) && finite(pt.value)).toBe(true);
        if (i > 0) expect(pt.time).toBeGreaterThanOrEqual(lane.points[i - 1].time);
      });
    });

    const clips = p.clipsByChannel[c.id];
    expect(Array.isArray(clips)).toBe(true);
    clips.forEach((clip) => {
      expect(clipIds.has(clip.id)).toBe(false);
      clipIds.add(clip.id);
      expect(clip.kind).toBe(c.type);
      [clip.offset, clip.length].forEach((v) => expect(finite(v)).toBe(true));
      if (clip.kind === "midi") {
        clip.notes.forEach((n) => {
          expect(n.note).toMatch(/^[A-G]#?-?\d+$/);
          [n.time, n.duration, n.velocity].forEach((v) => expect(finite(v)).toBe(true));
        });
      } else {
        [clip.durationSeconds, clip.sourceOffset, clip.fadeIn, clip.fadeOut, clip.gainDb].forEach((v) =>
          expect(finite(v)).toBe(true)
        );
        clip.peaks.forEach((v) => expect(finite(v)).toBe(true));
      }
    });
  });
  // No orphaned entries for tracks that don't exist.
  Object.keys(p.clipsByChannel).forEach((id) => expect(channelIds.has(id)).toBe(true));
  Object.keys(p.channelEffects).forEach((id) => expect(channelIds.has(id)).toBe(true));
  Object.keys(p.busEffects).forEach((id) => expect(busIds.has(id)).toBe(true));
}

describe("projects saved by earlier versions", () => {
  it("has fixtures to check", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures)("$name loads as a valid current project", ({ raw }) => {
    const project = normalizeProject(raw);
    expect(project).not.toBeNull();
    expectValidProject(project!);
  });

  it.each(fixtures)("$name keeps its tracks, clips and effects", ({ raw }) => {
    const r = raw as { channels: unknown[]; clipsByChannel: Record<string, unknown[]>; channelEffects: Record<string, unknown[]> };
    const project = normalizeProject(raw)!;
    expect(project.channels.length).toBe(r.channels.length);
    Object.entries(r.clipsByChannel).forEach(([id, clips]) => expect(project.clipsByChannel[id].length).toBe(clips.length));
    Object.entries(r.channelEffects).forEach(([id, fx]) => expect(project.channelEffects[id].length).toBe(fx.length));
  });

  it.each(fixtures)("$name is unchanged by a second pass (save -> load round trip)", ({ raw }) => {
    const once = normalizeProject(raw)!;
    const twice = normalizeProject(JSON.parse(JSON.stringify(once)))!;
    expect(twice).toEqual(once);
  });

  it("migrates the old Filter's type knob and its automation to the new mode", () => {
    const raw = fixtures.find((f) => f.name.startsWith("02-"))!.raw;
    const project = normalizeProject(raw)!;
    const filter = project.channelEffects["ch-1"].find((fx) => fx.id === "fx-1")!;
    expect(filter.params.mode).toBe(0);
    const lanes = project.channels[0].automationLanes!;
    const modeLane = lanes.find((l) => l.target.kind === "effect" && l.target.paramKey === "mode")!;
    expect(modeLane.points.map((pt) => pt.value)).toEqual([0, 1]);
  });

  it("gives pre-wavetable synth tracks a complete synth patch", () => {
    const raw = fixtures.find((f) => f.name.startsWith("02-"))!.raw;
    const project = normalizeProject(raw)!;
    const synth = project.channels[0].synthParams!;
    expect(synth.filter1.cutoff).toBe(2400);
    expect(synth.osc1.table).toBe("basic");
    expect(synth.osc1.position).toBe(0.5); // it was a sawtooth
    expect(synth.envs[0]).toMatchObject({ attack: 0.01, sustain: 0.6, release: 0.4 });
  });
});

describe("damaged saved data", () => {
  it.each([null, undefined, 0, "project", [], true])("rejects %j, which isn't a project", (raw) => {
    expect(normalizeProject(raw)).toBeNull();
  });

  it("turns an empty object into an empty project", () => {
    const project = normalizeProject({})!;
    expectValidProject(project);
    expect(project.channels).toEqual([]);
  });

  it("repairs wrong types, out-of-range values and dangling references", () => {
    const project = normalizeProject({
      bpm: "fast",
      timeSignature: { numerator: 0, denominator: 3 },
      masterVolume: Infinity,
      masterEffects: [
        { id: "fx-1", type: "flanger", params: {} },
        { id: "fx-2", type: "reverb", params: {} },
        { id: "fx-5", type: "reverb", params: { wet: 9 } },
      ],
      buses: [{ id: "bus-1" }, { id: "bus-1" }, { name: "no id" }],
      busEffects: { "bus-1": [{ id: "fx-2", type: "delay", params: {} }], "bus-9": [] },
      channels: [
        null,
        { id: "ch-1", type: "audio", instrument: "piano", sends: { "bus-1": -6, "bus-9": 0 },
          automationLanes: [
            { id: "a1", target: { kind: "effect", effectId: "fx-404", paramKey: "wet" }, points: [] },
            { id: "a2", target: { kind: "volume" }, points: [{ id: "p", time: 1, value: 50 }, { id: "q", time: NaN, value: 0 }] },
          ] },
        { id: "ch-1", type: "midi" },
        { id: "__proto__", type: "midi" },
        { id: "ch-2", type: "midi", instrument: "synth", synthParams: "broken" },
      ],
      clipsByChannel: {
        "ch-1": [{ id: "c1", kind: "midi", notes: [] }, { id: "c2", kind: "audio", peaks: [1, "x"] }],
        "ch-2": [{ id: "c2", kind: "midi", notes: [{ note: "H9" }, { note: "C4", time: 0, duration: 1, velocity: 2 }] }],
        "ch-gone": [{ id: "c3", kind: "midi", notes: [] }],
      },
      channelEffects: { "ch-1": "nope", "ch-2": [{ id: "fx-3", type: "filter", params: { type: 0.5, Q: 6 } }] },
    })!;
    expectValidProject(project);
    expect(project.bpm).toBe(120);
    // The unknown effect type is dropped, and so is the master reverb whose
    // id the bus delay already uses.
    expect(project.masterEffects.map((fx) => fx.id)).toEqual(["fx-5"]);
    expect(project.masterEffects[0].params.wet).toBe(1);
    expect(project.buses.map((b) => b.id)).toEqual(["bus-1"]);
    expect(project.busEffects["bus-1"].map((fx) => fx.type)).toEqual(["delay"]);
    expect(project.channels.map((c) => c.id)).toEqual(["ch-1", "ch-2"]);
    expect(project.channels[0].instrument).toBeNull();
    expect(project.channels[0].sends).toEqual({ "bus-1": -6 });
    expect(project.channels[0].automationLanes!.map((l) => l.id)).toEqual(["a2"]);
    expect(project.channels[0].automationLanes![0].points).toEqual([{ id: "p", time: 1, value: 6 }]);
    expect(project.clipsByChannel["ch-1"].map((c) => c.id)).toEqual(["c2"]);
    expect(project.clipsByChannel["ch-2"]).toEqual([]); // c2 was already used on ch-1
    expect(project.channels[1].synthParams).toEqual(initSynthParams());
    expect(project.channelEffects["ch-2"][0].params.mode).toBe(1);
  });

  it("keeps file references on file-based effects only", () => {
    const project = normalizeProject({
      channels: [{ id: "ch-1", type: "audio" }],
      channelEffects: {
        "ch-1": [
          { id: "fx-1", type: "irLoader", params: {}, file: { id: "file-abc", name: "4x12 SM57.wav" } },
          { id: "fx-2", type: "irLoader", params: {}, file: { name: "no id" } },
          { id: "fx-3", type: "irLoader", params: {}, file: "broken" },
          { id: "fx-4", type: "reverb", params: {}, file: { id: "file-xyz", name: "x.wav" } },
          { id: "fx-5", type: "namAmp", params: { input: 99, size: 0 }, file: { id: "file-nam", name: "Deluxe A2.nam" } },
        ],
      },
    })!;
    expectValidProject(project);
    const files = project.channelEffects["ch-1"].map((fx) => fx.file);
    expect(files).toEqual([
      { id: "file-abc", name: "4x12 SM57.wav" },
      undefined,
      undefined,
      undefined,
      { id: "file-nam", name: "Deluxe A2.nam" },
    ]);
    const amp = project.channelEffects["ch-1"][4];
    expect(amp.params).toMatchObject({ input: 20, size: 0, bass: 5, normalize: 1 });
  });

  it("never throws on randomly damaged versions of the fixtures", () => {
    // Deterministic PRNG (mulberry32) so a failure is reproducible.
    let seed = 0x5eed;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const junk = [null, undefined, NaN, -Infinity, 1e9, -1, "", "x", [], {}, true, 0.5, [null], { id: 5 }];
    const damage = (v: unknown): unknown => {
      if (rand() < 0.08) return junk[Math.floor(rand() * junk.length)];
      if (Array.isArray(v)) return v.map(damage).filter(() => rand() > 0.05);
      if (v && typeof v === "object") {
        return Object.fromEntries(
          Object.entries(v).filter(() => rand() > 0.05).map(([k, x]) => [k, damage(x)])
        );
      }
      return v;
    };
    for (let i = 0; i < 400; i++) {
      const { raw } = fixtures[i % fixtures.length];
      const damaged = damage(structuredClone(raw));
      const project = normalizeProject(damaged);
      if (project) expectValidProject(project);
    }
  });
});

describe("groups, routing and colors", () => {
  it("keeps groups, outputs, folds and picked colors, and drops what points nowhere", () => {
    const base = { volume: 0, pan: 0, colorIndex: 0, muted: false, solo: false, armed: false, instrument: null };
    const project = normalizeProject({
      version: PROJECT_VERSION,
      bpm: 120,
      channels: [
        { ...base, id: "m", name: "Kick", type: "midi", instrument: "drums", groupId: "g", color: "#12AB34" },
        { ...base, id: "g", name: "Drums", type: "group", folded: true, armed: true },
        { ...base, id: "v", name: "Vox", type: "audio", output: "nowhere" },
        { ...base, id: "s", name: "Synth", type: "midi", instrument: "piano", output: "v", color: "red" },
      ],
      clipsByChannel: { g: [{ id: "x", kind: "midi", offset: 0, length: 1, notes: [] }] },
    })!;
    expect(project.channels.map((c) => c.id)).toEqual(["g", "m", "v", "s"]);
    const [group, kick, vox, synth] = project.channels;
    expect(group).toMatchObject({ type: "group", folded: true, armed: false });
    expect(project.clipsByChannel.g).toEqual([]);
    expect(kick).toMatchObject({ groupId: "g", color: "#12ab34" });
    expect(vox.output).toBeUndefined();
    expect(synth.output).toBe("v");
    expect(synth.color).toBeUndefined();
  });

  it("keeps a track's takes, and drops broken ones and marks of takes that aren't there", () => {
    const base = { volume: 0, pan: 0, colorIndex: 0, muted: false, solo: false, armed: false, instrument: null };
    const clip = (id: string, extra = {}) => ({ id, kind: "midi", offset: 0, length: 1, notes: [], ...extra });
    const project = normalizeProject({
      version: PROJECT_VERSION,
      bpm: 120,
      channels: [
        { ...base, id: "m", name: "Keys", type: "midi", showTakes: true },
        { ...base, id: "g", name: "Group", type: "group", showTakes: true },
      ],
      clipsByChannel: { m: [clip("a", { take: "take-1" }), clip("b", { take: "take-9" })] },
      takesByChannel: {
        m: [
          { id: "take-1", name: "Take 1", clips: [clip("t1", { take: "take-1" }), clip("a")] },
          { id: "take-1", name: "Again", clips: [] },
          { name: "No id", clips: [] },
        ],
        g: [{ id: "take-2", name: "Take 2", clips: [] }],
        nowhere: [{ id: "take-3", name: "Take 3", clips: [] }],
      },
    })!;
    expect(Object.keys(project.takesByChannel)).toEqual(["m"]);
    const [lane] = project.takesByChannel.m;
    expect(project.takesByChannel.m).toHaveLength(1);
    // A take's clip isn't marked, and its id can't be one the track has.
    expect(lane.clips.map((c) => [c.id, c.take])).toEqual([["t1", undefined]]);
    expect(project.clipsByChannel.m.map((c) => [c.id, c.take])).toEqual([
      ["a", "take-1"],
      ["b", undefined],
    ]);
    expect(project.channels.find((c) => c.id === "m")!.showTakes).toBe(true);
    expect(project.channels.find((c) => c.id === "g")!.showTakes).toBeUndefined();
  });

  it("keeps a clip's name (one line, not too long) and color, and drops bad ones", () => {
    const base = { volume: 0, pan: 0, colorIndex: 0, muted: false, solo: false, armed: false, instrument: null };
    const project = normalizeProject({
      version: PROJECT_VERSION,
      bpm: 120,
      channels: [{ ...base, id: "m", name: "Keys", type: "midi" }],
      clipsByChannel: {
        m: [
          { id: "a", kind: "midi", offset: 0, length: 1, notes: [], name: "  Verse\n  riff ", color: "#AABBCC" },
          { id: "b", kind: "midi", offset: 1, length: 1, notes: [], name: "x".repeat(200), color: "blue" },
          { id: "c", kind: "midi", offset: 2, length: 1, notes: [], name: "   ", color: 7 },
        ],
      },
    })!;
    const [a, b, c] = project.clipsByChannel.m;
    expect(a).toMatchObject({ name: "Verse riff", color: "#aabbcc" });
    expect(b.name).toHaveLength(80);
    expect(b.color).toBeUndefined();
    expect("name" in c || "color" in c).toBe(false);
  });

  it("keeps an audio clip's warp (a tempo in range, markers in order), and drops a broken one", () => {
    const base = { volume: 0, pan: 0, colorIndex: 0, muted: false, solo: false, armed: false, instrument: null };
    const audio = { kind: "audio", length: 2, fileName: "loop.wav", durationSeconds: 2, peaks: [], sourceOffset: 0, fadeIn: 0, fadeOut: 0, gainDb: 0 };
    const project = normalizeProject({
      version: PROJECT_VERSION,
      bpm: 120,
      channels: [{ ...base, id: "v", name: "Loop", type: "audio" }],
      clipsByChannel: {
        v: [
          { ...audio, id: "a", offset: 0, warp: { mode: "repitch", bpm: 98.5, markers: [{ source: 1, beat: 2 }, { source: 0.5, beat: 3 }, { source: 2, beat: 4 }] } },
          { ...audio, id: "b", offset: 2, warp: { mode: "?", bpm: 900, markers: "no" } },
          { ...audio, id: "c", offset: 4, warp: { mode: "stretch" } },
        ],
      },
    })!;
    const [a, b, c] = project.clipsByChannel.v;
    expect("warp" in a && a.warp).toEqual({ mode: "repitch", bpm: 98.5, markers: [{ source: 0.5, beat: 3 }, { source: 2, beat: 4 }] });
    expect("warp" in b && b.warp).toEqual({ mode: "stretch", bpm: 300, markers: [] });
    expect("warp" in c).toBe(false);
  });

  it("keeps an audio track's input from another track, and drops bad ones", () => {
    const base = { volume: 0, pan: 0, colorIndex: 0, muted: false, solo: false, armed: false, instrument: null };
    const project = normalizeProject({
      version: PROJECT_VERSION,
      bpm: 120,
      channels: [
        { ...base, id: "s", name: "Synth", type: "midi", instrument: "piano" },
        { ...base, id: "p", name: "Print", type: "audio", input: { track: "s", tap: "preFx" } },
        { ...base, id: "q", name: "Odd tap", type: "audio", input: { track: "s", tap: "sideways" } },
        { ...base, id: "x", name: "Gone", type: "audio", input: { track: "nowhere", tap: "postFx" } },
        { ...base, id: "m", name: "MIDI", type: "midi", instrument: "piano", input: { track: "s", tap: "postFx" } },
      ],
    })!;
    const byId = Object.fromEntries(project.channels.map((c) => [c.id, c]));
    expect(byId.p.input).toEqual({ track: "s", tap: "preFx" });
    expect(byId.q.input).toEqual({ track: "s", tap: "postFx" });
    expect(byId.x.input).toBeUndefined();
    expect(byId.m.input).toBeUndefined();
  });
});

describe("monitored tracks", () => {
  const channels = [
    { id: "ch-1", name: "Gtr", type: "audio", volume: 0, pan: 0, colorIndex: 0, instrument: null, muted: false, solo: false, armed: false },
    { id: "ch-2", name: "Keys", type: "midi", volume: 0, pan: 0, colorIndex: 1, instrument: null, muted: false, solo: false, armed: false },
  ];

  it("an older project, saved before monitoring was, opens with none", () => {
    expect(normalizeProject({ channels })?.monitoredTracks).toEqual([]);
  });

  it("keeps only audio tracks that exist, once each", () => {
    expect(normalizeProject({ channels, monitoredTracks: ["ch-1", "ch-1", "ch-2", "ch-9", 5] })?.monitoredTracks).toEqual(["ch-1"]);
  });
});

describe("tempo changes", () => {
  it("an older project, saved before tempo changes were, has none", () => {
    expect(normalizeProject({ bpm: 100 })?.tempoChanges).toEqual([]);
  });

  it("keeps them in order, once a beat, in range, and drops ones that change nothing or are broken", () => {
    const project = normalizeProject({
      bpm: 100,
      tempoChanges: [{ beat: 16, bpm: 90 }, { beat: 8, bpm: 500 }, { beat: 12, bpm: 300 }, { beat: 0, bpm: 80 }, { beat: "x", bpm: 1 }, null],
    });
    expect(project?.tempoChanges).toEqual([
      { beat: 8, bpm: 300 },
      { beat: 16, bpm: 90 },
    ]);
  });
});
