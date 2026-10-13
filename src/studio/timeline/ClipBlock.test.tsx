// A clip with each edit tool (clipTools.ts): what clicking and dragging on
// it asks for. At 100 px a second, with the grid at half a second.

import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "@vitest/browser/context";
import type { ComponentProps } from "react";
import { ClipBlock } from "./ClipBlock";
import { TRACK_COLOR_PALETTE } from "@/project/colors";
import { drag, pointIn } from "@/test/pointer";

const PX = 100;

function renderClip(props: Partial<ComponentProps<typeof ClipBlock>> = {}) {
  const callbacks = {
    onSelect: vi.fn(),
    onEdit: vi.fn(),
    onMove: vi.fn(),
    onResize: vi.fn(),
    onContextMenu: vi.fn(),
    onDragStart: vi.fn(),
    onSplitAt: vi.fn(),
    onEraseStart: vi.fn(),
    onSlip: vi.fn(),
  };
  const screen = render(
    <div style={{ position: "relative", width: 1200, height: 118 }}>
      <ClipBlock
        clipId="c1"
        notes={[{ note: "C4", time: 0.5, duration: 0.5, velocity: 0.8 }]}
        color={TRACK_COLOR_PALETTE[0]}
        offset={2}
        length={4}
        pxPerSecond={PX}
        snapSeconds={0.5}
        selected={false}
        {...callbacks}
        {...props}
      />
    </div>
  );
  const clip = screen.container.querySelector<HTMLElement>("[data-clip-id]")!;
  return { screen, clip, ...callbacks };
}

const audio = { clipType: "audio" as const, notes: [], audioPeaks: [0.5, 0.5, 0.5, 0.5], audioFileName: "take.wav", durationSeconds: 10, sourceOffset: 1 };

describe("split", () => {
  test("a click cuts the clip there, on the grid", async () => {
    const { screen, clip, onSplitAt, onSelect } = renderClip({ tool: "split" });
    // 1.33 s into a clip that starts at 2 s: the grid point is 3.5 s.
    await userEvent.click(screen.getByTitle("Click to split the clip here"), { position: { x: 133, y: 40 } });
    expect(onSplitAt).toHaveBeenCalledWith(3.5);
    expect(onSelect).not.toHaveBeenCalled();
    expect(clip.style.cursor).toContain("url(");
  });

  test("near an end, where the grid point is the end, it cuts where clicked", async () => {
    const { screen, onSplitAt } = renderClip({ tool: "split" });
    await userEvent.click(screen.getByTitle("Click to split the clip here"), { position: { x: 10, y: 40 } });
    expect(onSplitAt.mock.lastCall?.[0]).toBeCloseTo(2.1, 1);
  });

  test("a line shows where it would cut", async () => {
    const { screen, clip } = renderClip({ tool: "split" });
    await userEvent.hover(screen.getByTitle("Click to split the clip here"), { position: { x: 133, y: 40 } });
    const line = clip.querySelector<HTMLElement>(".pointer-events-none.absolute.inset-y-0");
    expect(line?.style.left).toBe("150px");
  });
});

test("erase: the pointer going down on the clip starts erasing it", async () => {
  const { screen, onEraseStart, onSelect } = renderClip({ tool: "erase" });
  await screen.getByTitle(/^Click to delete the clip/).click();
  expect(onEraseStart).toHaveBeenCalledOnce();
  expect(onSelect).not.toHaveBeenCalled();
});

describe("slip", () => {
  test("dragging an audio clip slides its audio, on the grid, the clip staying put", () => {
    const { clip, onSlip, onDragStart, onMove } = renderClip({ tool: "slip", ...audio });
    const from = pointIn(clip, 100, 50);
    // A second right: the audio from 1 s earlier in the file shows.
    drag(clip, from, { x: from.x + 100, y: from.y });
    expect(onSlip).toHaveBeenLastCalledWith({ sourceOffset: 0 });
    // 1.4 s left, 1.5 s on the grid: from 2.5 s into the file.
    drag(clip, from, { x: from.x - 140, y: from.y });
    expect(onSlip).toHaveBeenLastCalledWith({ sourceOffset: 2.5 });
    expect(onDragStart).toHaveBeenCalledTimes(2);
    expect(onMove).not.toHaveBeenCalled();
  });

  test("an audio clip's audio slides only as far as its file goes", () => {
    const { clip, onSlip } = renderClip({ tool: "slip", ...audio });
    const from = pointIn(clip, 100, 50);
    drag(clip, from, { x: from.x - 900, y: from.y });
    // 10 s of file, 4 s of clip: its start can be at most 6 s in.
    expect(onSlip).toHaveBeenLastCalledWith({ sourceOffset: 6 });
  });

  test("dragging a MIDI clip slides its notes", () => {
    const { clip, onSlip } = renderClip({ tool: "slip" });
    const from = pointIn(clip, 100, 50);
    drag(clip, from, { x: from.x + 60, y: from.y });
    expect(onSlip).toHaveBeenLastCalledWith({ notes: [{ note: "C4", time: 1, duration: 0.5, velocity: 0.8 }] });
  });
});

test("the pointer tool keeps the clip's handles; the others act on the whole clip", async () => {
  const { screen } = renderClip({ tool: "pointer", ...audio });
  await expect.element(screen.getByTitle("Drag to resize the clip length")).toBeInTheDocument();
  await expect.element(screen.getByTitle(/^Drag to adjust this clip's gain/)).toBeInTheDocument();
  screen.rerender(
    <ClipBlock clipId="c1" tool="erase" {...audio} color={TRACK_COLOR_PALETTE[0]} offset={2} length={4} pxPerSecond={PX} selected={false} onSelect={vi.fn()} onEdit={vi.fn()} onMove={vi.fn()} onResize={vi.fn()} onContextMenu={vi.fn()} />
  );
  await expect.element(screen.getByTitle("Drag to resize the clip length")).not.toBeInTheDocument();
  await expect.element(screen.getByTitle(/^Drag to adjust this clip's gain/)).not.toBeInTheDocument();
});
