import { describe, expect, it } from "vitest";
import { silentReasons, silentText, type SilentTrack } from "./silentStates";

const track = (id: string, extra: Partial<SilentTrack> = {}): SilentTrack => ({
  id,
  name: id,
  type: "audio",
  instrument: null,
  muted: false,
  solo: false,
  volume: 0,
  ...extra,
});

describe("why a track is silent", () => {
  it("is nothing when everything plays", () => {
    expect(silentReasons([track("a"), track("b")]).size).toBe(0);
  });

  it("another track soloed, unless it's on that track's path", () => {
    const tracks = [track("g", { type: "group" }), track("gtr", { groupId: "g", solo: true }), track("bass", { groupId: "g" }), track("vox")];
    const out = silentReasons(tracks);
    // The soloed track's group plays (it's on the path); its neighbour in
    // the group and the track outside don't.
    expect([...out]).toEqual([
      ["bass", { kind: "solo" }],
      ["vox", { kind: "solo" }],
    ]);
  });

  it("what it plays into is muted, before any solo", () => {
    const tracks = [track("g", { type: "group", name: "Drums", muted: true }), track("kick", { groupId: "g" }), track("fx", { output: "kick" }), track("other", { solo: true })];
    const out = silentReasons(tracks);
    expect(out.get("kick")).toEqual({ kind: "routeMuted", via: "Drums" });
    // Two steps down: into kick, then the muted group.
    expect(out.get("fx")).toEqual({ kind: "routeMuted", via: "Drums" });
    // Muted itself: its M button says so.
    expect(out.has("g")).toBe(false);
  });

  it("its fader all the way down", () => {
    expect([...silentReasons([track("a", { volume: -60 }), track("b", { volume: -59 })])]).toEqual([["a", { kind: "faderDown" }]]);
  });

  it("a MIDI track with no instrument", () => {
    const out = silentReasons([track("keys", { type: "midi", instrument: null }), track("piano", { type: "midi", instrument: "piano" })]);
    expect([...out]).toEqual([["keys", { kind: "noInstrument" }]]);
  });

  it("says why", () => {
    expect(silentText({ kind: "routeMuted", via: "Drums" }).detail).toBe("Silent: it plays through Drums, which is muted.");
    expect(silentText({ kind: "solo" }).label).toBe("Silent");
  });
});
