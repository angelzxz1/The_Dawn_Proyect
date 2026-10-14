import { describe, expect, it } from "vitest";
import {
  DISTORTION_SHAPES,
  SHAPE_ORDER,
  biquadDb,
  colorGains,
  colorResponse,
  colorSettingsFromParams,
  distortionShapeFromParam,
  distortionTransfer,
  softClip,
} from "./saturatorModel";

const SR = 48000;

describe("saturator curves", () => {
  it("keeps the original Soft/Hard/Fold sounds at 0, 1, 2", () => {
    const g = 1 + 30 * 0.4;
    for (const x of [-0.7, -0.1, 0.05, 0.3, 0.9]) {
      expect(distortionTransfer(distortionShapeFromParam(0), 0.4, 0, x)).toBeCloseTo(Math.tanh(g * x), 12);
      expect(distortionTransfer(distortionShapeFromParam(1), 0.4, 0, x)).toBeCloseTo(Math.max(-1, Math.min(1, g * x)), 12);
      expect(distortionTransfer(distortionShapeFromParam(2), 0.4, 0, x)).toBeCloseTo(Math.sin((Math.PI / 2) * g * x), 12);
    }
  });

  it("every curve is silent at silence, symmetric, and within full scale", () => {
    DISTORTION_SHAPES.forEach((shape) => {
      expect(distortionTransfer(shape, 0.5, 0, 0)).toBe(0);
      for (let x = -4; x <= 4; x += 0.05) {
        const y = distortionTransfer(shape, 0.5, 0, x);
        expect(Math.abs(y), shape).toBeLessThanOrEqual(1 + 1e-12);
        expect(distortionTransfer(shape, 0.5, 0, -x)).toBeCloseTo(-y, 12);
      }
    });
  });

  it("the clip curves pass quiet signals at unity and get harder in order", () => {
    // Drive 0 (x1): a -40 dB signal comes out at -40 dB.
    SHAPE_ORDER.filter((s) => s !== "fold").forEach((shape) => {
      expect(distortionTransfer(shape, 0, 0, 0.01) / 0.01, shape).toBeCloseTo(1, 3);
    });
    // At full scale in, gentlest to harshest.
    const atFull = ["medium", "analog", "softSine", "hard", "digital"].map((s) => distortionTransfer(s as never, 0, 0, 1));
    atFull.slice(1).forEach((v, i) => expect(v).toBeGreaterThan(atFull[i]));
    expect(atFull[4]).toBe(1);
  });

  it("Bias makes it asymmetric but still silent at silence", () => {
    expect(distortionTransfer("analog", 0.5, 0.4, 0)).toBeCloseTo(0, 12);
    expect(distortionTransfer("analog", 0.5, 0.4, 0.5)).not.toBeCloseTo(-distortionTransfer("analog", 0.5, 0.4, -0.5), 3);
  });
});

describe("soft clip", () => {
  it("is untouched below -6 dB and never passes 0 dB", () => {
    expect(softClip(0.3)).toBe(0.3);
    expect(softClip(-0.5)).toBe(-0.5);
    expect(softClip(0.9)).toBeLessThan(0.9);
    expect(softClip(10)).toBeLessThanOrEqual(1);
    // Smooth at the knee.
    expect(softClip(0.5001) - softClip(0.5)).toBeCloseTo(0.0001, 6);
  });
});

describe("color EQ", () => {
  const params = { colorOn: 1, colorBase: 6, colorFreq: 1200, colorQ: 0.8, colorDepth: 9 };

  it("its filters hit their gains", () => {
    expect(biquadDb("peaking", 1200, 0.8, 9, 1200, SR)).toBeCloseTo(9, 3);
    expect(biquadDb("lowshelf", 250, Math.SQRT1_2, 6, 10, SR)).toBeCloseTo(6, 1);
    expect(biquadDb("lowshelf", 250, Math.SQRT1_2, 6, 10000, SR)).toBeCloseTo(0, 1);
  });

  it("Pre, Post and Emphasis put the EQ where they say", () => {
    const at = (mode: number, f: number) => colorResponse(colorSettingsFromParams({ ...params, colorMode: mode }), f, SR);
    expect(at(0, 1200).pre).toBeCloseTo(9, 0);
    expect(at(0, 1200).post).toBe(0);
    expect(at(1, 1200).pre).toBe(0);
    expect(at(1, 1200).post).toBeCloseTo(9, 0);
    // Emphasis: the cut after exactly undoes the boost before, at every
    // frequency, so clean audio comes out with its tone unchanged.
    for (const f of [20, 100, 250, 600, 1200, 3000, 12000]) {
      const r = at(2, f);
      expect(r.pre + r.post, `${f} Hz`).toBeCloseTo(0, 9);
    }
  });

  it("does nothing while off", () => {
    const g = colorGains(colorSettingsFromParams({ ...params, colorOn: 0, colorMode: 2 }));
    expect([g.pre.base, g.pre.depth, g.post.base, g.post.depth].every((v) => v === 0)).toBe(true);
  });
});
