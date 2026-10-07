import { describe, expect, it } from "vitest";
import { EFFECT_GROUPS, EFFECT_TYPES, effectDefinition } from "./registry";

describe("effect registry", () => {
  it("every effect has a unique key and label, and a place in the browser", () => {
    expect(new Set(EFFECT_TYPES).size).toBe(EFFECT_TYPES.length);
    const labels = EFFECT_TYPES.map((t) => effectDefinition(t).label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(EFFECT_GROUPS.flatMap((g) => g.types).sort()).toEqual([...EFFECT_TYPES].sort());
    EFFECT_GROUPS.forEach((g) => expect(g.types.length, g.name).toBeGreaterThan(0));
  });

  it("every parameter has a unique key, a default within its range, and reads as text", () => {
    for (const type of EFFECT_TYPES) {
      const params = effectDefinition(type).params;
      const keys = params.map((p) => p.key);
      expect(new Set(keys).size, type).toBe(keys.length);
      for (const p of params) {
        expect(p.min, `${type}.${p.key}`).toBeLessThan(p.max);
        expect(p.default, `${type}.${p.key}`).toBeGreaterThanOrEqual(p.min);
        expect(p.default, `${type}.${p.key}`).toBeLessThanOrEqual(p.max);
        for (const v of [p.min, p.default, p.max]) expect(typeof p.format(v), `${type}.${p.key}`).toBe("string");
      }
    }
  });
});
