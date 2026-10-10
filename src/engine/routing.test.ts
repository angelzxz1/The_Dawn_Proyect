import { describe, expect, it } from "vitest";
import {
  canMoveTrack,
  downstreamOf,
  groupTracks,
  hiddenByFoldedGroups,
  inputMap,
  inputSources,
  moveTrack,
  normalizeGroups,
  outputTargets,
  routeMap,
  setTrackGroup,
  soloAudible,
  ungroup,
  upstreamOf,
} from "./routing";
import type { ChannelConfig } from "../project/types";

const track = (id: string, extra: Partial<ChannelConfig> = {}): ChannelConfig => ({
  id,
  name: id,
  volume: 0,
  pan: 0,
  colorIndex: 0,
  type: "midi",
  instrument: "piano",
  muted: false,
  solo: false,
  armed: false,
  ...extra,
});
const group = (id: string, extra: Partial<ChannelConfig> = {}) => track(id, { type: "group", instrument: null, ...extra });
const ids = (list: ChannelConfig[]) => list.map((c) => c.id);

describe("routes", () => {
  it("members feed their group, outputs override it, and the rest go to the master", () => {
    const routes = routeMap([
      group("drums"),
      track("kick", { groupId: "drums" }),
      track("snare", { groupId: "drums", output: "master" }),
      track("vox", { type: "audio" }),
      track("synth", { output: "vox" }),
      track("keys", { output: "synth" }), // a MIDI track can't take audio
    ]);
    expect(Object.fromEntries(routes)).toEqual({ drums: null, kick: "drums", snare: null, vox: null, synth: "vox", keys: null });
  });

  it("never loops", () => {
    const routes = routeMap([track("a", { type: "audio", output: "b" }), track("b", { type: "audio", output: "a" })]);
    expect(routes.get("a")).toBeNull();
    expect(routes.get("b")).toBe("a");
  });

  it("knows what feeds a track and where it ends up", () => {
    const nodes = [group("g"), track("a", { groupId: "g" }), track("bus", { type: "audio" }), track("b", { output: "bus" })];
    const routes = routeMap([...nodes, track("x", { type: "audio", output: "bus" }), track("y", { output: "x" })]);
    expect([...upstreamOf("bus", routes)].sort()).toEqual(["b", "x", "y"]);
    expect(downstreamOf("y", routes)).toEqual(["x", "bus"]);
    // A track can't be sent into anything that already feeds it.
    const all = [...nodes, track("x", { type: "audio", output: "bus" })];
    expect(ids(outputTargets("bus", all))).toEqual(["g"]);
    expect(ids(outputTargets("a", all))).toEqual(["g", "bus", "x"]);
  });

  it("solo keeps a soloed track's whole path open", () => {
    const nodes = [group("g", { solo: true }), track("a", { groupId: "g" }), track("b")];
    expect([...soloAudible(nodes)].sort()).toEqual(["a", "g"]);
    const member = [group("g"), track("a", { groupId: "g", solo: true }), track("c", { groupId: "g" }), track("b")];
    expect([...soloAudible(member)].sort()).toEqual(["a", "g"]);
    expect(soloAudible([track("a"), track("b")]).size).toBe(2);
  });
});

describe("groups", () => {
  it("groups tracks where the first one was, members right after the group", () => {
    const list = groupTracks([track("a"), track("b"), track("c"), track("d")], ["d", "b"], group("G"));
    expect(ids(list)).toEqual(["a", "G", "b", "d", "c"]);
    expect(list.filter((c) => c.groupId === "G").map((c) => c.id)).toEqual(["b", "d"]);
  });

  it("ungroups, keeping a group's output for its members", () => {
    const list = ungroup([group("G", { output: "bus" }), track("a", { groupId: "G" }), track("bus", { type: "audio" })], "G");
    expect(ids(list)).toEqual(["a", "bus"]);
    expect(list[0].groupId).toBeUndefined();
    expect(list[0].output).toBe("bus");
  });

  it("moves tracks in and out of groups", () => {
    const start = [group("G"), track("a", { groupId: "G" }), track("b"), track("c")];
    const inside = setTrackGroup(start, "c", "G");
    expect(ids(inside)).toEqual(["G", "a", "c", "b"]);
    const outside = setTrackGroup(inside, "a", null);
    expect(ids(outside)).toEqual(["G", "c", "a", "b"]);
    expect(outside[2].groupId).toBeUndefined();
  });

  it("moves a group with its members, and members within their group", () => {
    const start = [track("x"), group("G"), track("a", { groupId: "G" }), track("b", { groupId: "G" }), track("y")];
    expect(ids(moveTrack(start, "G", -1))).toEqual(["G", "a", "b", "x", "y"]);
    expect(ids(moveTrack(start, "y", -1))).toEqual(["x", "y", "G", "a", "b"]);
    expect(ids(moveTrack(start, "b", -1))).toEqual(["x", "G", "b", "a", "y"]);
    expect(canMoveTrack(start, "a", -1)).toBe(false);
    expect(canMoveTrack(start, "x", -1)).toBe(false);
  });

  it("cleans up odd saved groups and hides folded members", () => {
    const list = normalizeGroups([track("a", { groupId: "gone" }), track("m", { groupId: "G" }), group("G", { groupId: "G2", folded: true })]);
    expect(ids(list)).toEqual(["a", "G", "m"]);
    expect(list[0].groupId).toBeUndefined();
    expect(list[1].groupId).toBeUndefined();
    expect([...hiddenByFoldedGroups(list)]).toEqual(["m"]);
  });
});

describe("track inputs (Audio From)", () => {
  const audio = (id: string, extra: Partial<ChannelConfig> = {}) => track(id, { type: "audio", instrument: null, ...extra });

  it("an audio track takes another track's audio at a tap point", () => {
    const nodes = [track("synth"), audio("print", { input: { track: "synth", tap: "postFx" } })];
    expect(inputMap(nodes).get("print")).toEqual({ track: "synth", tap: "postFx" });
    // The source still goes to the master.
    expect(routeMap(nodes).get("synth")).toBeNull();
  });

  it("ignores inputs on MIDI tracks, from itself, or from a missing track", () => {
    const nodes = [
      track("m", { input: { track: "a", tap: "preFx" } }),
      audio("a", { input: { track: "a", tap: "preFx" } }),
      audio("b", { input: { track: "gone", tap: "preFx" } }),
    ];
    expect(inputMap(nodes).size).toBe(0);
  });

  it("never closes a loop through outputs and inputs", () => {
    // a sends its output into b, and b would take a's audio back: a loop.
    const nodes = [audio("a", { output: "b", input: { track: "b", tap: "postFader" } }), audio("b")];
    expect(inputMap(nodes).has("a")).toBe(false);
    // Two tracks taking each other's input: the first one wins.
    const pair = [audio("x", { input: { track: "y", tap: "preFx" } }), audio("y", { input: { track: "x", tap: "preFx" } })];
    expect([...inputMap(pair).keys()]).toEqual(["x"]);
  });

  it("only offers sources and destinations that can't loop", () => {
    const nodes = [audio("a"), audio("b", { input: { track: "a", tap: "postFx" } }), audio("c")];
    // b listens to a, so a can't take b (or send its output to b and back).
    expect(inputSources("a", nodes).map((n) => n.id)).toEqual(["c"]);
    expect(inputSources("b", nodes).map((n) => n.id)).toEqual(["a", "c"]);
    // b can't send its output into a: a feeds b.
    expect(outputTargets("b", nodes).map((n) => n.id)).toEqual(["c"]);
    // a sending into b as well is fine: both paths run the same way.
    expect(outputTargets("a", nodes).map((n) => n.id)).toEqual(["b", "c"]);
  });
});
