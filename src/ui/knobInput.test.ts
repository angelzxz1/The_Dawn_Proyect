import { describe, expect, it } from "vitest";
import { FINE_FACTOR, WHEEL_STEP, wheelTurn } from "./knobInput";

const wheel = (deltaY: number, extra: Partial<{ deltaX: number; deltaMode: number; shiftKey: boolean }> = {}) => ({
  deltaX: 0,
  deltaMode: 0,
  shiftKey: false,
  ...extra,
  deltaY,
});

describe("wheelTurn", () => {
  it("turns up when the wheel rolls away, one step per notch", () => {
    expect(wheelTurn(wheel(-100))).toBeCloseTo(WHEEL_STEP);
    expect(wheelTurn(wheel(100))).toBeCloseTo(-WHEEL_STEP);
    expect(wheelTurn(wheel(-3, { deltaMode: 1 }))).toBeCloseTo(WHEEL_STEP * 0.99);
  });

  it("is finer with Shift, including Shift+wheel sent sideways", () => {
    expect(wheelTurn(wheel(-100, { shiftKey: true }))).toBeCloseTo(WHEEL_STEP * FINE_FACTOR);
    expect(wheelTurn(wheel(0, { deltaX: -100, shiftKey: true }))).toBeCloseTo(WHEEL_STEP * FINE_FACTOR);
  });

  it("leaves sideways swipes alone and caps fast spins", () => {
    expect(wheelTurn(wheel(0, { deltaX: 80 }))).toBe(0);
    expect(wheelTurn(wheel(-2000))).toBeCloseTo(WHEEL_STEP * 3);
    expect(wheelTurn(wheel(-10))).toBeCloseTo(WHEEL_STEP * 0.1);
  });
});
