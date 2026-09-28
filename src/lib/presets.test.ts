import { beforeEach, describe, expect, it, vi } from "vitest";
import { EFFECT_TYPES, defaultParams, paramSpecs } from "./effects";

// A minimal browser: localStorage and window events.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
vi.stubGlobal("window", { addEventListener: () => {} });

const presets = await import("./presets");
const { FACTORY_PRESETS, findPreset, matchesPreset, paramsFromPreset, presetsFor, saveUserPreset, renameUserPreset, deleteUserPreset, overwriteUserPreset, userPresets, resetPresetCache } = presets;

beforeEach(() => {
  store.clear();
  resetPresetCache();
});

describe("factory presets", () => {
  it("every effect has at least three, with unique names and ids", () => {
    EFFECT_TYPES.forEach((type) => {
      const list = FACTORY_PRESETS.filter((p) => p.type === type);
      expect(list.length, type).toBeGreaterThanOrEqual(3);
      expect(new Set(list.map((p) => p.name)).size, type).toBe(list.length);
    });
    expect(new Set(FACTORY_PRESETS.map((p) => p.id)).size).toBe(FACTORY_PRESETS.length);
  });

  it("only set real params, inside their ranges", () => {
    FACTORY_PRESETS.forEach((p) => {
      const specs = paramSpecs(p.type);
      Object.entries(p.params).forEach(([key, value]) => {
        const spec = specs.find((s) => s.key === key);
        expect(spec, `${p.name}: ${key}`).toBeDefined();
        if (p.tempoRelative && key.startsWith("delayTime")) return;
        expect(value, `${p.name}: ${key}`).toBeGreaterThanOrEqual(spec!.min);
        expect(value, `${p.name}: ${key}`).toBeLessThanOrEqual(spec!.max);
      });
    });
  });
});

describe("loading", () => {
  it("starts from the defaults, keeping view settings", () => {
    const current = { ...defaultParams("paramEq"), b5On: 1, b5Gain: 6, scale: 24, analyzer: 0 };
    const out = paramsFromPreset(findPreset("factory:paramEq:low-cut-100-hz")!, current, 120);
    expect(out.b1On).toBe(1);
    expect(out.b1Freq).toBe(100);
    // The band the preset doesn't use is reset; the display isn't.
    expect(out.b5On).toBe(0);
    expect(out.scale).toBe(24);
    expect(out.analyzer).toBe(0);
  });

  it("follows the tempo for synced delays", () => {
    const dotted = findPreset("factory:delay:dotted-eighth-stereo")!;
    expect(paramsFromPreset(dotted, {}, 120)).toMatchObject({ delayTimeL: 0.25, delayTimeR: 0.375 });
    expect(paramsFromPreset(dotted, {}, 90).delayTimeL).toBeCloseTo(1 / 3, 6);
  });

  it("knows when settings still match", () => {
    const p = findPreset("factory:compressor:vocal-leveler")!;
    const params = paramsFromPreset(p, {}, 120);
    expect(matchesPreset(p, params, 120)).toBe(true);
    expect(matchesPreset(p, { ...params, threshold: -10 }, 120)).toBe(false);
    // Listen isn't part of a preset.
    expect(matchesPreset(p, { ...params, scListen: 1 }, 120)).toBe(true);
  });
});

describe("user presets", () => {
  it("save, reload, rename, overwrite and delete", () => {
    const params = { ...defaultParams("compressor"), threshold: -33, ratio: 7 };
    const saved = saveUserPreset("compressor", "  My Vox  ", params, 120);
    expect(saved.name).toBe("My Vox");
    // Survives a reload (a fresh read of storage).
    resetPresetCache();
    expect(presetsFor("compressor").user.map((p) => p.name)).toEqual(["My Vox"]);
    expect(paramsFromPreset(findPreset(saved.id)!, {}, 120)).toMatchObject({ threshold: -33, ratio: 7 });

    // Saving under the same name replaces it.
    saveUserPreset("compressor", "my vox", { ...params, ratio: 3 }, 120);
    expect(userPresets()).toHaveLength(1);
    expect(findPreset(saved.id)!.params.ratio).toBe(3);

    saveUserPreset("compressor", "Drums", params, 120);
    expect(renameUserPreset(saved.id, "Drums")).toBe(false); // taken
    expect(renameUserPreset(saved.id, "Lead Vox")).toBe(true);
    expect(overwriteUserPreset(saved.id, { ...params, ratio: 12 }, 120)!.name).toBe("Lead Vox");
    expect(findPreset(saved.id)!.params.ratio).toBe(12);
    deleteUserPreset(saved.id);
    expect(presetsFor("compressor").user.map((p) => p.name)).toEqual(["Drums"]);
  });

  it("stores synced delay times in beats", () => {
    const params = { ...defaultParams("delay"), delayTimeL: 0.25, delayTimeR: 0.5, sync: 1 };
    const saved = saveUserPreset("delay", "Eighths", params, 120);
    expect(saved.params.delayTimeL).toBe(0.5);
    expect(paramsFromPreset(saved, {}, 60).delayTimeL).toBe(0.5);
    const free = saveUserPreset("delay", "Free", { ...params, sync: 0 }, 120);
    expect(paramsFromPreset(free, {}, 60).delayTimeL).toBe(0.25);
  });

  it("skips damaged entries in storage", () => {
    store.set(
      "dawn-effect-presets-v1",
      JSON.stringify([
        { id: "a", type: "compressor", name: "Ok", params: { threshold: -500, bogus: 3, ratio: "x" } },
        { id: "b", type: "nope", name: "Bad type", params: {} },
        { id: "c", type: "gate", name: "", params: {} },
        null,
        { id: "a", type: "gate", name: "Duplicate id", params: {} },
      ])
    );
    const list = userPresets();
    expect(list.map((p) => p.name)).toEqual(["Ok"]);
    expect(list[0].params).toEqual({ threshold: -60 });
    store.set("dawn-effect-presets-v1", "{not json");
    resetPresetCache();
    expect(userPresets()).toEqual([]);
  });
});
