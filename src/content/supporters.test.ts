import { describe, expect, it } from "vitest";
import { MEMBERS, supporterProblems } from "./supporters";

describe("supporters.json", () => {
  it("lists each member once, by a name that fits", () => {
    expect(supporterProblems(MEMBERS)).toEqual([]);
  });

  it("catches blank, overlong and repeated names", () => {
    expect(supporterProblems({ producers: ["Ana", " "], supporters: ["x".repeat(41), "ana"] })).toEqual([
      "producers: a blank name",
      `supporters: "${"x".repeat(41)}" is longer than 40 characters`,
      'supporters: "ana" is listed twice',
    ]);
  });
});
