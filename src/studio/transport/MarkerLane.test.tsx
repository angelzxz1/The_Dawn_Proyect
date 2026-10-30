// The section lane on its own: adding, naming, jumping to, moving, looping
// and removing markers, through the actions it's handed.

import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "@vitest/browser/context";
import { MarkerLane } from "./MarkerLane";
import { makeTempoMap } from "@/project/tempoMap";
import type { SongMarker } from "@/project/markers";

// 120 BPM, 50 px a second: a beat is 25 px, a bar 100 px.
const PX = 50;

function lane(markers: SongMarker[] = []) {
  const actions = { onAdd: vi.fn(), onRename: vi.fn(), onMove: vi.fn(), onRemove: vi.fn(), onJump: vi.fn(), onLoop: vi.fn() };
  const screen = render(<MarkerLane markers={markers} tempo={makeTempoMap(120)} pxPerSecond={PX} totalSeconds={40} beatsPerBar={4} snapUnit={4} {...actions} />);
  return { screen, ...actions };
}

const SONG: SongMarker[] = [
  { id: "a", beat: 0, name: "Intro" },
  { id: "b", beat: 8, name: "Verse" },
];

describe("the section lane", () => {
  test("double-clicking adds a marker on the nearest bar, named like a song", async () => {
    const { screen, onAdd } = lane(SONG);
    await screen.getByTestId("marker-lane").dblClick({ position: { x: 390, y: 8 } });
    const input = screen.getByRole("textbox", { name: "Section name" });
    await expect.element(input).toHaveValue("Chorus");
    await userEvent.fill(input, "Hook");
    await userEvent.keyboard("{Enter}");
    expect(onAdd).toHaveBeenCalledWith(16, "Hook");
  });

  test("Escape adds nothing", async () => {
    const { screen, onAdd } = lane();
    await screen.getByTestId("marker-lane").dblClick({ position: { x: 120, y: 8 } });
    await userEvent.keyboard("{Escape}");
    expect(onAdd).not.toHaveBeenCalled();
  });

  test("clicking a marker jumps there, double-clicking renames it", async () => {
    const { screen, onJump, onRename } = lane(SONG);
    const verse = screen.getByRole("button", { name: /^Verse, from 3\.1\.1/ });
    await verse.click();
    expect(onJump).toHaveBeenCalledWith(8);
    await verse.dblClick();
    await userEvent.fill(screen.getByRole("textbox", { name: "Section name" }), "Chorus");
    await userEvent.keyboard("{Enter}");
    expect(onRename).toHaveBeenCalledWith("b", "Chorus");
  });

  test("dragging a marker moves it along the grid", async () => {
    const { screen, onMove, onJump } = lane(SONG);
    const verse = screen.getByRole("button", { name: /^Verse/ }).element() as HTMLElement;
    const box = verse.getBoundingClientRect();
    const y = box.top + box.height / 2;
    verse.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: box.left + 2, clientY: y, pointerId: 1 }));
    verse.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: box.left + 2 + 190, clientY: y, pointerId: 1 }));
    verse.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: box.left + 2 + 190, clientY: y, pointerId: 1 }));
    expect(onMove).toHaveBeenCalledWith("b", 16);
    expect(onJump).not.toHaveBeenCalled();
  });

  test("its menu loops the section, names it and removes it", async () => {
    const { screen, onLoop, onRename, onRemove } = lane(SONG);
    const verse = screen.getByRole("button", { name: /^Verse/ });
    await verse.click({ button: "right" });
    await screen.getByRole("button", { name: "Loop Verse" }).click();
    expect(onLoop).toHaveBeenCalledWith("b");
    await verse.click({ button: "right" });
    await screen.getByRole("button", { name: "Bridge" }).click();
    expect(onRename).toHaveBeenCalledWith("b", "Bridge");
    await verse.click({ button: "right" });
    await screen.getByRole("button", { name: "Remove marker" }).click();
    expect(onRemove).toHaveBeenCalledWith("b");
  });
});
