import { afterEach, describe, expect, it, vi } from "vitest";
import { audioBlobs } from "./audioBlobs";
import { projectStore } from "./projectStore";
import type { AudioClipInstance } from "@/project/types";

const clip = (id: string, url: string): AudioClipInstance => ({
  id,
  kind: "audio",
  offset: 0,
  length: 1,
  url,
  fileName: "take.wav",
  durationSeconds: 1,
  peaks: [],
  sourceOffset: 0,
  fadeIn: 0,
  fadeOut: 0,
  gainDb: 0,
  loopLength: null,
});

afterEach(() => {
  vi.restoreAllMocks();
  audioBlobs.clear();
});

describe("letting go of audio no step can bring back", () => {
  it("keeps a file's URL while another clip that can come back plays it", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const file = new Blob(["take"]);
    audioBlobs.set("whole", file);
    audioBlobs.set("part", file);
    projectStore.set("clipsByChannel", { a: [clip("whole", "blob:take")] });
    projectStore.push();
    // An edit makes a part of the clip (the same file), then is undone...
    projectStore.set("clipsByChannel", { a: [clip("part", "blob:take")] });
    projectStore.undo();
    // ...and something else done instead: the part can't come back.
    projectStore.push();
    expect(audioBlobs.get("part")).toBeUndefined();
    // The clip that's there plays the same file: its URL stays.
    expect(audioBlobs.get("whole")).toBe(file);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("counts a take's clips as there", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    audioBlobs.set("t1", new Blob(["x"]));
    projectStore.set("clipsByChannel", { a: [] });
    projectStore.set("takesByChannel", { a: [{ id: "take-1", name: "Take 1", clips: [clip("t1", "blob:t")] }] });
    projectStore.push();
    projectStore.set("takesByChannel", {});
    projectStore.undo();
    projectStore.push();
    expect(audioBlobs.get("t1")).toBeDefined();
    expect(revoke).not.toHaveBeenCalled();
  });

  it("lets go of a file once nothing that can come back plays it", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    audioBlobs.set("gone", new Blob(["x"]));
    projectStore.set("clipsByChannel", { a: [] });
    projectStore.set("takesByChannel", {});
    projectStore.push();
    projectStore.set("clipsByChannel", { a: [clip("gone", "blob:gone")] });
    projectStore.undo();
    projectStore.push();
    expect(audioBlobs.get("gone")).toBeUndefined();
    expect(revoke).toHaveBeenCalledWith("blob:gone");
  });
});
