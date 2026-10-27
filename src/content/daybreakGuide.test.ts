import { describe, expect, it } from "vitest";
import { FACTORY_SYNTH_PRESETS } from "@/instruments/synth/synthPresets";
import { DAYBREAK_PRESET_NOTES, DAYBREAK_SECTIONS } from "./daybreakGuide";

describe("the Daybreak guide", () => {
  it("describes every factory preset, and only those", () => {
    const names = FACTORY_SYNTH_PRESETS.map((p) => p.name);
    expect(names.filter((n) => !DAYBREAK_PRESET_NOTES[n])).toEqual([]);
    expect(Object.keys(DAYBREAK_PRESET_NOTES).filter((n) => !names.includes(n))).toEqual([]);
  });

  it("gives every section its own id", () => {
    const ids = DAYBREAK_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
