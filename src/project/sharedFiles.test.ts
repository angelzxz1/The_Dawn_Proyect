import { describe, expect, it } from "vitest";
import { shareFiles, unshareFiles } from "./sharedFiles";

describe("shared files", () => {
  it("keeps each file once, under the first id that has it, and gives them all back", () => {
    const take = new Blob(["take"]);
    const other = new Blob(["other"]);
    const blobs = new Map([
      ["clip-1", take],
      ["clip-2", other],
      ["clip-3", take],
      ["clip-4", take],
    ]);
    const { files, aliases } = shareFiles(blobs);
    expect([...files.keys()]).toEqual(["clip-1", "clip-2"]);
    expect(aliases).toEqual({ "clip-3": "clip-1", "clip-4": "clip-1" });

    const back = unshareFiles(files, aliases);
    expect([...back.keys()].sort()).toEqual(["clip-1", "clip-2", "clip-3", "clip-4"]);
    expect(back.get("clip-4")).toBe(back.get("clip-1"));
  });

  it("ignores aliases that point nowhere or aren't there", () => {
    const files = new Map([["a", new Blob(["x"])]]);
    expect([...unshareFiles(files, { b: "missing", c: 3 }).keys()]).toEqual(["a"]);
    expect([...unshareFiles(files, undefined).keys()]).toEqual(["a"]);
  });
});
