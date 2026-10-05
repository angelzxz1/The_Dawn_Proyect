import { describe, expect, it } from "vitest";
import { automationCurrentValue, automationRange, automationTargetKey, automationTargetOptions } from "./automationTargets";
import { defaultParams, type EffectInstance } from "./effects";
import type { ChannelConfig } from "./types";

describe("automation targets", () => {
  it("keys targets so equal targets match", () => {
    expect(automationTargetKey({ kind: "volume" })).toBe("volume");
    expect(automationTargetKey({ kind: "effect", effectId: "fx-1", paramKey: "wet" })).toBe("effect:fx-1:wet");
  });

  it("offers volume, pan and each effect's automatable params", () => {
    const fx: EffectInstance = { id: "fx-1", type: "reverb", bypass: false, params: defaultParams("reverb") };
    const options = automationTargetOptions([fx]);
    expect(options.slice(0, 2).map((o) => o.label)).toEqual(["Volume", "Pan"]);
    expect(options.length).toBeGreaterThan(2);
    expect(options.slice(2).every((o) => o.target.kind === "effect" && o.target.effectId === "fx-1")).toBe(true);
  });

  it("edits in each target's own range and reads its live value", () => {
    expect(automationRange({ kind: "volume" }, []).min).toBe(-60);
    expect(automationRange({ kind: "pan" }, []).format(-0.5)).toBe("50L");
    const channel = { volume: -6, pan: 0.25 } as ChannelConfig;
    expect(automationCurrentValue({ kind: "volume" }, channel, [])).toBe(-6);
    expect(automationCurrentValue({ kind: "pan" }, channel, [])).toBe(0.25);
  });
});
