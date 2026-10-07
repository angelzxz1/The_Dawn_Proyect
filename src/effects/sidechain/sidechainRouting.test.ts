import { describe, expect, it } from "vitest";
import { canKeyFrom, keyDelay, resolveSidechains, tapLatency, type RoutingSnapshot, type SidechainRequest } from "./sidechainRouting";

const ch = (id: string, over: Partial<RoutingSnapshot["channels"][number]> = {}) => ({ id, sends: [], chain: 0, pdc: 0, toMaster: 0, ...over });
const link = (hostId: string, effectId: string, source: string | null, on = true): SidechainRequest => ({
  hostId,
  effectId,
  routing: { on, source, tap: "postFx" },
});

describe("sidechain loops", () => {
  const snapshot: RoutingSnapshot = {
    channels: [ch("kick"), ch("bass", { sends: ["verb"] }), ch("pad")],
    buses: [{ id: "verb", chain: 0, pdc: 0 }],
  };

  it("connects ordinary keys", () => {
    const accepted = resolveSidechains(snapshot, [link("bass", "c1", "kick"), link("master", "c2", "kick"), link("verb", "c3", "pad")]);
    expect([...accepted]).toEqual([
      ["c1", "kick"],
      ["c2", "kick"],
      ["c3", "pad"],
    ]);
  });

  it("leaves out off, missing and self keys", () => {
    expect(resolveSidechains(snapshot, [link("bass", "a", "kick", false), link("bass", "b", "gone"), link("bass", "c", "bass"), link("bass", "d", null)]).size).toBe(0);
  });

  it("refuses a key from a bus the track feeds", () => {
    // bass -> verb, so verb keying bass's compressor would be a loop.
    expect(resolveSidechains(snapshot, [link("bass", "c1", "verb")]).size).toBe(0);
    expect(canKeyFrom(snapshot, [], "bass", "verb")).toBe(false);
    expect(canKeyFrom(snapshot, [], "pad", "verb")).toBe(true);
  });

  it("refuses the second of two tracks keying each other", () => {
    const accepted = resolveSidechains(snapshot, [link("kick", "c1", "pad"), link("pad", "c2", "kick")]);
    expect([...accepted.keys()]).toEqual(["c1"]);
    expect(canKeyFrom(snapshot, [link("kick", "c1", "pad")], "pad", "kick")).toBe(false);
    // A loop through a bus: pad keys from bass, bass sends to verb, and
    // verb keyed from pad would close it.
    expect(canKeyFrom(snapshot, [link("pad", "c1", "verb")], "bass", "pad")).toBe(false);
  });

  it("never offers the master as a source", () => {
    expect(canKeyFrom(snapshot, [], "bass", "master")).toBe(false);
  });
});

describe("sidechain timing", () => {
  // kick: 5 ms of effects, delayed 3 ms to match bass's 8 ms chain.
  const snapshot: RoutingSnapshot = {
    channels: [ch("kick", { chain: 0.005, pdc: 0.003, toMaster: 0.01, sends: ["verb"] }), ch("bass", { chain: 0.008, toMaster: 0.01 })],
    buses: [{ id: "verb", chain: 0.01, pdc: 0 }],
  };

  it("knows how late each tap point is", () => {
    expect(tapLatency(snapshot, "kick", "preFx")).toBe(0);
    expect(tapLatency(snapshot, "kick", "postFx")).toBeCloseTo(0.005, 9);
    expect(tapLatency(snapshot, "kick", "postFader")).toBeCloseTo(0.008, 9);
    // The bus hears kick after its strip (8 ms), then adds 10 ms.
    expect(tapLatency(snapshot, "verb", "postFx")).toBeCloseTo(0.018, 9);
  });

  it("delays the key to meet the effect's input", () => {
    // A compressor after 8 ms of bass effects, keyed from kick pre-FX: 8 ms.
    expect(keyDelay(snapshot, "bass", 0.008, "kick", "preFx")).toBeCloseTo(0.008, 9);
    // Post-FX: kick is already 5 ms late.
    expect(keyDelay(snapshot, "bass", 0.008, "kick", "postFx")).toBeCloseTo(0.003, 9);
    // First on the chain, the key would have to arrive early: no delay.
    expect(keyDelay(snapshot, "bass", 0, "kick", "postFx")).toBe(0);
    // On the master everything's arrived by 18 ms (the kick through the
    // direct path and the bus).
    expect(keyDelay(snapshot, "master", 0, "kick", "preFx")).toBeCloseTo(0.018, 9);
  });
});
