import { describe, expect, it } from "vitest";
import { CREDITS, creditProblems, type CreditEntry } from "./credits";

describe("licenses.json", () => {
  it("lists everything with a name, author, license and purpose", () => {
    expect(creditProblems(CREDITS)).toEqual([]);
    expect(CREDITS.some((c) => c.id === "salamander-grand-piano")).toBe(true);
  });

  it("catches incomplete entries", () => {
    const sound: CreditEntry = { id: "x", name: "X", kind: "sound", author: "A", license: "CC0", usedFor: "y" };
    expect(creditProblems([sound])).toEqual(["x: sounds need a source and the date they were added"]);
    expect(creditProblems([{ ...sound, kind: "software" }, { ...sound, kind: "software" }])).toEqual(["x: duplicate id"]);
    expect(creditProblems([{ ...sound, kind: "font", url: "http://x" }])).toEqual(["x: url isn't an https link"]);
  });
});
