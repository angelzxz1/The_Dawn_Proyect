import { describe, expect, it } from "vitest";
import { audibleTracks, planMix, type MixInput, type MixTrack } from "./mixGraph";

const track = (id: string, extra: Partial<MixTrack> = {}): MixTrack => ({
  id,
  type: "midi",
  latency: 0,
  live: false,
  muted: false,
  solo: false,
  sends: [],
  ...extra,
});

const mixOf = (tracks: MixTrack[], extra: Partial<MixInput> = {}): MixInput => ({
  tracks,
  buses: [],
  masterLatency: 0,
  compensation: true,
  hosts: [],
  ...extra,
});

describe("the mix plan", () => {
  it("sends each track into its group or chosen track, the rest through the direct delay", () => {
    const mix = planMix(
      mixOf([
        track("g", { type: "group" }),
        track("kick", { groupId: "g" }),
        track("gtr", { type: "audio", output: "amp" }),
        track("amp", { type: "audio" }),
        track("keys", { live: true }),
      ])
    );
    expect(mix.outputs.get("kick")).toEqual({ kind: "track", id: "g" });
    expect(mix.outputs.get("gtr")).toEqual({ kind: "track", id: "amp" });
    expect(mix.outputs.get("g")).toEqual({ kind: "direct" });
    // Played live: straight to the master, skipping the shared delay.
    expect(mix.outputs.get("keys")).toEqual({ kind: "master" });
    expect(mix.snapshot.channels.find((c) => c.id === "keys")!.toMaster).toBe(0);
  });

  it("hears unmuted tracks, and only a soloed track's path when something is soloed", () => {
    const tracks = [track("g", { type: "group" }), track("a", { groupId: "g", solo: true }), track("b", { groupId: "g" }), track("c", { muted: true })];
    expect([...planMix(mixOf(tracks)).audible].sort()).toEqual(["a", "g"]);
    expect([...audibleTracks(tracks.map((t) => ({ ...t, solo: false })))].sort()).toEqual(["a", "b", "g"]);
  });

  it("connects a keyed effect to its source, delayed to line up with the effect's input", () => {
    // The bass has a 3 ms effect before its compressor, so the compressor's
    // input is 3 ms late (the bass's own compensation comes after its
    // chain). The kick's post-FX key is already 10 ms late - nothing to add,
    // it can't be pulled earlier; its pre-FX key (0 ms) waits 3 ms.
    const tracks = [track("kick", { latency: 0.01 }), track("bass", { latency: 0.003 })];
    const hosts = [
      {
        id: "bass",
        effects: [
          { id: "eq", latency: 0.003, bypass: false, keyed: false },
          { id: "comp", latency: 0, bypass: false, keyed: true, sidechain: { on: true, source: "kick", tap: "postFx" as const } },
          { id: "gate", latency: 0, bypass: false, keyed: true, sidechain: { on: true, source: "kick", tap: "preFx" as const } },
        ],
      },
    ];
    const mix = planMix(mixOf(tracks, { hosts }));
    expect(mix.sidechains.get("comp")).toMatchObject({ source: "kick", tap: "postFx" });
    expect(mix.sidechains.get("comp")!.delay).toBeCloseTo(0, 9);
    expect(mix.sidechains.get("gate")!.delay).toBeCloseTo(0.003, 9);
    expect(mix.requests.map((r) => r.effectId)).toEqual(["comp", "gate"]);
  });

  it("leaves out a key that would loop, and effects that can't take one", () => {
    // The kick's compressor keyed by the group the kick plays through: a loop.
    const tracks = [track("g", { type: "group" }), track("kick", { groupId: "g" })];
    const hosts = [
      { id: "kick", effects: [{ id: "comp", latency: 0, bypass: false, keyed: true, sidechain: { on: true, source: "g", tap: "postFx" as const } }] },
      { id: "g", effects: [{ id: "eq", latency: 0, bypass: false, keyed: false, sidechain: { on: true, source: "kick", tap: "postFx" as const } }] },
    ];
    const mix = planMix(mixOf(tracks, { hosts }));
    expect(mix.sidechains.size).toBe(0);
  });

  it("keeps an audio track's input from another track", () => {
    const mix = planMix(mixOf([track("synth"), track("print", { type: "audio", input: { track: "synth", tap: "preFx" } })]));
    expect(mix.inputs.get("print")).toEqual({ track: "synth", tap: "preFx" });
    expect(mix.snapshot.channels.find((c) => c.id === "print")!.inputFrom).toBe("synth");
  });
});
