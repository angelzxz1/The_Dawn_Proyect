import { describe, expect, it } from "vitest";
import { detectRoundTrip, planCompensation } from "./latency";

describe("delay compensation", () => {
  const input = {
    enabled: true,
    channels: [
      { id: "a", latency: 0, live: false },
      { id: "b", latency: 0.005, live: false },
      { id: "c", latency: 0.002, live: false },
    ],
    buses: [
      { id: "verb", latency: 0 },
      { id: "crush", latency: 0.003 },
    ],
    master: 0.005,
  };

  it("lines every track and bus path up at the master", () => {
    const plan = planCompensation(input);
    // Each track's chain + its delay is the same.
    input.channels.forEach((c) => expect(c.latency + plan.channel.get(c.id)!).toBeCloseTo(0.005, 9));
    // A send's path (bus chain + bus delay) matches the direct path's delay.
    input.buses.forEach((b) => expect(b.latency + plan.bus.get(b.id)!).toBeCloseTo(plan.direct, 9));
    expect(plan.direct).toBeCloseTo(0.003, 9);
    expect(plan.total).toBeCloseTo(0.005 + 0.003 + 0.005, 9);
    expect(plan.compensated).toBeCloseTo(0.008, 9);
  });

  it("live tracks skip compensation and don't set the others' delay", () => {
    const plan = planCompensation({ ...input, channels: [...input.channels, { id: "guitar", latency: 0.05, live: true }] });
    expect(plan.channel.get("guitar")).toBe(0);
    expect(plan.channel.get("a")).toBeCloseTo(0.005, 9);
  });

  it("off: no delays, the mix is only as late as the master chain", () => {
    const plan = planCompensation({ ...input, enabled: false });
    expect([...plan.channel.values(), ...plan.bus.values(), plan.direct]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(plan.total).toBe(0.005);
  });
});

describe("round-trip measurement", () => {
  const sr = 48000;
  const clicks = [4800, 33600, 62400, 91200, 120000];
  const click = new Float32Array(192).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 2500 * i) / sr) * Math.sin((Math.PI * i) / 192));
  const recording = (delay: number, noise = 0.002, level = 0.6, invert = false) => {
    const out = new Float32Array(150000).map(() => (Math.random() * 2 - 1) * noise);
    for (const at of clicks) for (let i = 0; i < click.length; i++) out[at + delay + i] += (invert ? -level : level) * click[i];
    return out;
  };

  it("finds how late the clicks came back, to the sample", () => {
    expect(detectRoundTrip(recording(2150), sr, clicks, click)! * sr).toBeCloseTo(2150, 6);
    expect(detectRoundTrip(recording(517, 0.002, 0.2, true), sr, clicks, click)! * sr).toBeCloseTo(517, 6);
  });

  it("gives up when the clicks can't be heard over the noise", () => {
    expect(detectRoundTrip(recording(2150, 0.2, 0.05), sr, clicks, click)).toBeNull();
    expect(detectRoundTrip(new Float32Array(150000), sr, clicks, click)).toBeNull();
  });
});

describe("delay compensation through routed tracks", () => {
  it("lines up a group's members at its input, and the group with the rest at the master", () => {
    const plan = planCompensation({
      enabled: true,
      channels: [
        { id: "group", latency: 0.002, live: false },
        { id: "kick", latency: 0.004, live: false, dest: "group" },
        { id: "snare", latency: 0, live: false, dest: "group" },
        { id: "bass", latency: 0.001, live: false },
      ],
      buses: [],
      master: 0,
    });
    // Members arrive at the group together, 4 ms in.
    expect(0.004 + plan.channel.get("kick")!).toBeCloseTo(0.004, 9);
    expect(0 + plan.channel.get("snare")!).toBeCloseTo(0.004, 9);
    // The group leaves its chain at 6 ms, the latest at the master.
    expect(plan.channel.get("group")).toBeCloseTo(0, 9);
    expect(0.001 + plan.channel.get("bass")!).toBeCloseTo(0.006, 9);
    // The group has no sources of its own to delay; members' sends wait for
    // the group's 2 ms.
    expect(plan.own.get("group")).toBeCloseTo(0.004, 9);
    expect(plan.send.get("kick")).toBeCloseTo(0.002, 9);
    expect(plan.send.get("bass")).toBeCloseTo(0, 9);
    expect(plan.total).toBeCloseTo(0.006, 9);
  });
});
