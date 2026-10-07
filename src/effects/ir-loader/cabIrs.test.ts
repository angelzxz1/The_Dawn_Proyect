import { describe, expect, it } from "vitest";
import { cabImpulse, cabResponseDb, FACTORY_CABS, irResponseDb } from "./cabIrs";

const SR = 48000;

describe("factory cabinet IRs", () => {
  it("each IR has its designed response through the guitar range", () => {
    for (const cab of FACTORY_CABS) {
      const ir = cabImpulse(cab, SR);
      // Compare the shape (relative to 1 kHz) at a few points below the rolloff.
      const ref = irResponseDb(ir, SR, 1000) - cabResponseDb(cab.design, 1000);
      for (const f of [150, 300, 600, 1500, 2500, 3500]) {
        const got = irResponseDb(ir, SR, f) - ref;
        expect(Math.abs(got - cabResponseDb(cab.design, f)), `${cab.name} at ${f} Hz`).toBeLessThan(1.5);
      }
      // Lows and highs are cut, as a speaker does.
      expect(irResponseDb(ir, SR, cab.design.lowHz / 2.5) - ref, cab.name).toBeLessThan(cabResponseDb(cab.design, 400) - 10);
      expect(irResponseDb(ir, SR, 12000) - ref, cab.name).toBeLessThan(cabResponseDb(cab.design, 2000) - 20);
    }
  });

  it("is minimum phase: nearly all the energy arrives in the first 5 ms", () => {
    for (const cab of FACTORY_CABS) {
      const ir = cabImpulse(cab, SR);
      let early = 0;
      let total = 0;
      ir.forEach((v, i) => {
        total += v * v;
        if (i < SR * 0.005) early += v * v;
      });
      expect(early / total, cab.name).toBeGreaterThan(0.9);
      expect(ir.every((v) => Number.isFinite(v))).toBe(true);
      expect(Math.abs(ir[ir.length - 1])).toBeLessThan(1e-6);
    }
  });

  it("has stable, unique ids and generates the same IR every time", () => {
    expect(new Set(FACTORY_CABS.map((c) => c.id)).size).toBe(FACTORY_CABS.length);
    expect(FACTORY_CABS.every((c) => c.id.startsWith("factory-ir:"))).toBe(true);
    expect(cabImpulse(FACTORY_CABS[0], SR)).toEqual(cabImpulse(FACTORY_CABS[0], SR));
  });
});
