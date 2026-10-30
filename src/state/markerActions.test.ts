import { beforeEach, describe, expect, it } from "vitest";
import { markerActions } from "./markerActions";
import { projectStore } from "./projectStore";

beforeEach(() => projectStore.load({ ...projectStore.get(), markers: [] }, [], []));

const names = () => projectStore.get().markers.map((m) => `${m.name}@${m.beat}`);

describe("marker actions", () => {
  it("adds markers named like a song, each one undo step", () => {
    markerActions.add(0);
    markerActions.add(16);
    markerActions.add(8, "  Pre  ");
    expect(names()).toEqual(["Intro@0", "Pre@8", "Verse@16"]);
    expect(markerActions.add(16)).toBeNull();
    projectStore.undo();
    expect(names()).toEqual(["Intro@0", "Verse@16"]);
  });

  it("renames, moves and removes, and does nothing that changes nothing", () => {
    const id = markerActions.add(16)!;
    markerActions.add(32);
    const steps = () => projectStore.allSteps().past.length;
    const before = steps();
    expect(markerActions.rename(id, "   ")).toBe(false);
    expect(markerActions.rename(id, "Intro")).toBe(false);
    expect(markerActions.move(id, 16)).toBe(false);
    expect(markerActions.move(id, 32)).toBe(false);
    expect(steps()).toBe(before);
    markerActions.rename(id, "Chorus");
    markerActions.move(id, 48);
    expect(names()).toEqual(["Verse@32", "Chorus@48"]);
    markerActions.remove(id);
    expect(names()).toEqual(["Verse@32"]);
    expect(steps()).toBe(before + 3);
  });
});
