import { describe, expect, it } from "vitest";
import { snapBeatsForResolution } from "./musicTime";
import { normalizeProject } from "./projectSchema";

describe("the snap grid", () => {
  it("is fixed, off, or (Adaptive) what the zoom shows", () => {
    expect(snapBeatsForResolution("bar", 3)).toBe(3);
    expect(snapBeatsForResolution("1/8", 4)).toBe(0.5);
    expect(snapBeatsForResolution("off", 4)).toBe(0);
    expect(snapBeatsForResolution("auto", 4, 0.25)).toBe(0.25);
    expect(snapBeatsForResolution("auto", 4, 8)).toBe(8);
  });

  it("is saved with the project, Adaptive too", () => {
    expect(normalizeProject({ snapResolution: "auto" })?.snapResolution).toBe("auto");
    expect(normalizeProject({ snapResolution: "sometimes" })?.snapResolution).toBe("bar");
  });
});
