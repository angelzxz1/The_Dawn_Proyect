import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { EFFECT_CHAINS } from "./chains";
import { factoryCab } from "./ir-loader/cabIrs";
import { CREDITS } from "../lib/credits";
import { paramSpecs } from "./registry";
import { findPreset } from "./presets";
import { parseToneManifest } from "../library/tones";

describe("effect chains", () => {
  it("use presets, settings and cabinets that exist", () => {
    for (const chain of EFFECT_CHAINS) {
      expect(chain.steps.length, chain.id).toBeGreaterThan(1);
      for (const step of chain.steps) {
        if (step.preset) expect(findPreset(step.preset)?.type, `${chain.id}: ${step.preset}`).toBe(step.type);
        const keys = new Set(paramSpecs(step.type).map((s) => s.key));
        for (const key of Object.keys(step.params ?? {})) expect(keys.has(key), `${chain.id}: ${step.type}.${key}`).toBe(true);
        if (step.file) expect(factoryCab(step.file.id), `${chain.id}: ${step.file.id}`).toBeTruthy();
      }
    }
  });
});

describe("tone manifest", () => {
  it("is valid, and every bundled tone is credited in licenses.json", () => {
    const raw = JSON.parse(readFileSync("public/tones/manifest.json", "utf8"));
    expect(raw.version).toBe(1);
    const tones = parseToneManifest(raw);
    expect(tones).toHaveLength(raw.tones.length); // none dropped as malformed
    for (const t of tones) expect(CREDITS.some((c) => c.id === t.id), `${t.id} needs an entry in licenses.json`).toBe(true);
  });

  it("rejects entries that point outside tones/ or have the wrong file type", () => {
    const base = { id: "x", kind: "amp", name: "X", creator: "Y" };
    expect(parseToneManifest({ version: 1, tones: [{ ...base, file: "tones/x.nam" }] })).toHaveLength(1);
    expect(parseToneManifest({ version: 1, tones: [{ ...base, file: "tones/../secret.nam" }] })).toHaveLength(0);
    expect(parseToneManifest({ version: 1, tones: [{ ...base, file: "tones/x.wav" }] })).toHaveLength(0);
    expect(parseToneManifest({ version: 1, tones: [{ ...base, kind: "ir", file: "https://evil/x.wav" }] })).toHaveLength(0);
  });
});
