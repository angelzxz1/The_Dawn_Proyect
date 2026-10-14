import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAM_TARGET_LOUDNESS_DB, namSlimSize, normalizationDb, parseNamFile, toneStack } from "./namModel";

const lstm = readFileSync(join(__dirname, "__fixtures__", "nam", "lstm.nam"), "utf8");

describe("reading .nam files", () => {
  it("reads a real model's metadata", () => {
    const result = parseNamFile(lstm);
    expect("info" in result).toBe(true);
    if (!("info" in result)) return;
    expect(result.info).toEqual({
      title: "Test LSTM",
      subtitle: "Amp · Clean",
      modeledBy: "Steve",
      architecture: "LSTM",
      isA2: false,
      sampleRate: 48000,
      loudness: expect.closeTo(-37.84, 2),
    });
  });

  it("recognizes A2 models and falls back to the gear name", () => {
    const a2 = JSON.stringify({
      version: "0.7.0",
      architecture: "SlimmableContainer",
      config: { submodels: [] },
      weights: [],
      sample_rate: 48000,
      metadata: { gear_make: "Fender", gear_model: "Deluxe Reverb", loudness: -26.4 },
    });
    const result = parseNamFile(a2);
    if (!("info" in result)) throw new Error("expected a model");
    expect(result.info.isA2).toBe(true);
    expect(result.info.architecture).toBe("A2");
    expect(result.info.title).toBe("Fender Deluxe Reverb");
  });

  it("copes with models that have no metadata", () => {
    const result = parseNamFile(JSON.stringify({ version: "0.5.0", architecture: "WaveNet", config: {}, weights: [] }));
    if (!("info" in result)) throw new Error("expected a model");
    expect(result.info).toMatchObject({ title: null, subtitle: null, sampleRate: null, loudness: null });
  });

  it("rejects files that aren't models", () => {
    expect(parseNamFile("{not json")).toHaveProperty("error");
    expect(parseNamFile(JSON.stringify({ hello: "world" }))).toHaveProperty("error");
    expect(parseNamFile("[1, 2, 3]")).toHaveProperty("error");
  });
});

describe("output normalization", () => {
  it("brings the model's loudness to the plugin's target", () => {
    expect(normalizationDb(true, -26.4)).toBeCloseTo(NAM_TARGET_LOUDNESS_DB + 26.4, 6);
    expect(normalizationDb(true, -8.5)).toBeCloseTo(-9.5, 6);
  });

  it("does nothing when off or when the model has no loudness", () => {
    expect(normalizationDb(false, -26.4)).toBe(0);
    expect(normalizationDb(true, null)).toBe(0);
  });
});

describe("tone stack", () => {
  it("is flat with every knob at 5", () => {
    const t = toneStack(5, 5, 5);
    expect([t.bass.gainDb, t.middle.gainDb, t.treble.gainDb]).toEqual([0, 0, 0]);
  });

  it("matches the NAM plugin's ranges and frequencies", () => {
    const max = toneStack(10, 10, 10);
    const min = toneStack(0, 0, 0);
    expect([max.bass.gainDb, max.middle.gainDb, max.treble.gainDb]).toEqual([20, 15, 10]);
    expect([min.bass.gainDb, min.middle.gainDb, min.treble.gainDb]).toEqual([-20, -15, -10]);
    expect([max.bass.frequency, max.middle.frequency, max.treble.frequency]).toEqual([150, 425, 1800]);
    // The mid band widens when cutting.
    expect(max.middle.q).toBe(0.7);
    expect(min.middle.q).toBe(1.5);
  });
});

describe("model size", () => {
  it("maps the Full/Lite switch to the engine's slim size", () => {
    expect(namSlimSize(1)).toBe(1);
    expect(namSlimSize(0)).toBe(0);
  });
});
