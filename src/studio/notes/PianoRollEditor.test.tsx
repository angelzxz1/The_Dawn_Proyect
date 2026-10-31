// The piano roll on its own: what drawing, moving, selecting and the keys
// do to the clip's notes (what it hands onChange), and how its view scrolls
// with the playhead. The engine's clock is a stand-in the tests move.

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "@vitest/browser/context";
import type { ComponentProps } from "react";
import { PianoRollEditor } from "./PianoRollEditor";
import { TRACK_COLOR_PALETTE } from "@/project/colors";
import type { NoteEvent } from "@/project/types";
import { drag, pointIn } from "@/test/pointer";
import { DRUM_PADS } from "@/instruments/drum-rack/drums";

const transport = vi.hoisted(() => ({ seconds: 0 }));
vi.mock("@/engine/audioEngine", () => ({
  audioEngine: { getTransportSeconds: () => transport.seconds },
}));

// 120 BPM: a beat is half a second, a 1/16 an eighth of one.
const BEAT = 0.5;
const SIXTEENTH = 0.125;
const MAX_MIDI = 108;
const ROW_H = 13;

beforeEach(() => {
  transport.seconds = 0;
});

function note(name: string, time: number, duration = BEAT, velocity = 0.8): NoteEvent {
  return { note: name, time, duration, velocity };
}

function renderRoll(props: Partial<ComponentProps<typeof PianoRollEditor>> = {}) {
  const onChange = vi.fn<(notes: NoteEvent[]) => void>();
  const onPreviewNote = vi.fn();
  const onPlay = vi.fn();
  const onPause = vi.fn();
  const length = props.length ?? 4;
  const screen = render(
    <PianoRollEditor
      channelName="Lead"
      color={TRACK_COLOR_PALETTE[0]}
      notes={[]}
      length={length}
      bpm={120}
      beatsPerBar={4}
      offset={0}
      scaleSetting={{ root: "C", scale: "major", enabled: false }}
      onScaleChange={vi.fn()}
      onChange={onChange}
      onClose={vi.fn()}
      onPreviewNote={onPreviewNote}
      isPlaying={false}
      onPlay={onPlay}
      onPause={onPause}
      {...props}
    />
  );
  const grid = document.getElementById("piano-roll-grid")!;
  const content = grid.firstElementChild as HTMLElement;
  /** Where a time and pitch are drawn, from the grid's content's top-left
   * (a little into the 1/16 and the middle of the row). */
  const at = (seconds: number, midi: number) => ({
    x: Math.round(seconds * pxPerSecond() + 3),
    y: (MAX_MIDI - midi) * ROW_H + ROW_H / 2,
  });
  const pxPerSecond = () => content.offsetWidth / length;
  /** Drags on the grid from one time and pitch to another, starting on
   * whatever is there (a note, its edge, or empty space). */
  const dragOnGrid = (from: [number, number], to: [number, number], start?: Element) => {
    const a = at(...from);
    const b = at(...to);
    drag(start ?? content, pointIn(content, a.x, a.y), pointIn(content, b.x, b.y));
  };
  return {
    screen,
    grid,
    content: page.elementLocator(content),
    at,
    dragOnGrid,
    pxPerSecond,
    onChange,
    onPreviewNote,
    onPlay,
    onPause,
    /** The notes as last handed to onChange. */
    notes: () => onChange.mock.lastCall?.[0],
    noteAt: (i: number) => page.elementLocator(content.querySelectorAll("[data-note-id]")[i]),
    /** Zooms all the way in, then shows the clip's start. */
    zoomIn: async () => {
      const button = screen.getByTitle("Zoom in");
      for (let i = 0; i < 6; i++) await button.click();
      grid.scrollLeft = 0;
      return grid.clientWidth / pxPerSecond();
    },
  };
}

const nextFrame = () => new Promise(requestAnimationFrame);

describe("drawing", () => {
  test("a click draws a beat-long note at that pitch, on the 1/16 grid", async () => {
    const roll = renderRoll();
    await userEvent.click(roll.content, { position: roll.at(1.03, 60) });
    expect(roll.notes()).toEqual([note("C4", 1)]);
    expect(roll.onPreviewNote).toHaveBeenCalledWith("C4");
  });

  test("dragging while drawing sets the note's length", async () => {
    const roll = renderRoll();
    roll.dragOnGrid([0.5, 62], [1.6, 62]);
    // From 0.5 to the 1/16 nearest the pointer, 1.625.
    expect(roll.notes()).toEqual([note("D4", 0.5, 1.125)]);
  });

  test("on a drum track, a note lands on the nearest pad's row", async () => {
    const roll = renderRoll({ instrument: "drums" });
    // The 16 pads are the notes from C1 (the kick) up: a click above them
    // lands on the top pad.
    const top = DRUM_PADS[DRUM_PADS.length - 1];
    await userEvent.click(roll.content, { position: roll.at(0, top.midi + 4) });
    expect(roll.notes()).toEqual([note(top.note, 0)]);
    // The keys are named after the pads.
    await expect.element(roll.screen.getByTitle("Kick", { exact: true })).toBeVisible();
  });
});

describe("editing notes", () => {
  test("right-clicking a note deletes it", async () => {
    const roll = renderRoll({ notes: [note("C4", 0), note("E4", 1)] });
    await userEvent.click(roll.noteAt(0), { button: "right" });
    expect(roll.notes()).toEqual([note("E4", 1)]);
  });

  test("dragging a note moves it by semitones and 1/16s", async () => {
    const roll = renderRoll({ notes: [note("C4", 1)] });
    roll.dragOnGrid([1.05, 60], [1.55, 62], roll.noteAt(0).element());
    expect(roll.notes()).toEqual([note("D4", 1.5)]);
  });

  test("dragging a note's right edge changes its length", async () => {
    const roll = renderRoll({ notes: [note("C4", 0)] });
    const handle = roll.noteAt(0).element().lastElementChild!;
    const edge = handle.getBoundingClientRect();
    const start = { x: edge.left + 2, y: edge.top + 4 };
    // Half a second (a beat) further right.
    drag(handle, start, { x: start.x + BEAT * roll.pxPerSecond(), y: start.y });
    expect(roll.notes()).toEqual([note("C4", 0, 1)]);
  });

  test("clicking a note selects it without moving it, even off the grid", async () => {
    const roll = renderRoll({ notes: [note("C4", 0.3)] });
    await userEvent.click(roll.noteAt(0));
    expect(roll.onChange).not.toHaveBeenCalled();
    await expect.element(roll.noteAt(0)).toHaveClass(/ring-2/);
  });

  test("arrow keys nudge the selected note; Q quantizes it", async () => {
    const roll = renderRoll({ notes: [note("C4", 0.3)] });
    await userEvent.click(roll.noteAt(0));
    await userEvent.keyboard("{ArrowUp}");
    expect(roll.notes()).toEqual([note("C#4", 0.3)]);
    await userEvent.keyboard("{ArrowRight}");
    expect(roll.notes()?.[0].time).toBeCloseTo(0.3 + SIXTEENTH);
    // To the 1/16 grid (the default resolution).
    await userEvent.keyboard("q");
    expect(roll.notes()).toEqual([note("C#4", 0.375)]);
  });

  test("the Velocity box sets the selected notes' velocity", async () => {
    const roll = renderRoll({ notes: [note("C4", 0), note("E4", 1)] });
    await userEvent.click(roll.noteAt(0));
    await userEvent.click(roll.noteAt(1), { modifiers: ["Shift"] });
    const velocity = roll.screen.getByRole("textbox", { name: /Velocity/ });
    await userEvent.fill(velocity, "64");
    await userEvent.keyboard("{Enter}");
    expect(roll.notes()).toEqual([note("C4", 0, BEAT, 64 / 127), note("E4", 1, BEAT, 64 / 127)]);
  });

  describe("drawing velocities", () => {
    const four = [note("C4", 0), note("E4", 1), note("G4", 2), note("A4", 3)];
    // The velocity lane: 65 px tall, full velocity 59 px up.
    const laneAt = (roll: ReturnType<typeof renderRoll>, seconds: number, velocity: number) => {
      const lane = document.querySelector<HTMLElement>("[data-velocity-lane]")!;
      return { lane, point: pointIn(lane, seconds * roll.pxPerSecond(), 65 - velocity * 59) };
    };
    const midi = (notes: NoteEvent[] | undefined) => notes?.map((n) => Math.round(n.velocity * 127));

    test("a drag across the lane puts the notes it spans on a line", () => {
      const roll = renderRoll({ notes: four });
      const from = laneAt(roll, 0, 0.2);
      const to = laneAt(roll, 2, 0.6);
      drag(from.lane, from.point, to.point);
      // 0.2, 0.4 and 0.6 of 127; the last note is past the line.
      expect(midi(roll.notes())).toEqual([25, 51, 76, 102]);
    });

    test("with a selection, only the selected notes", async () => {
      const roll = renderRoll({ notes: four });
      await userEvent.click(roll.noteAt(1));
      const from = laneAt(roll, 0, 0.3);
      const to = laneAt(roll, 3, 0.3);
      drag(from.lane, from.point, to.point);
      expect(midi(roll.notes())).toEqual([102, 38, 102, 102]);
    });

    test("with Alt, freehand: each note takes the value where the pointer crosses it", () => {
      const roll = renderRoll({ notes: four });
      const lane = laneAt(roll, 0, 0).lane;
      const a = laneAt(roll, 0.5, 0.9).point;
      const b = laneAt(roll, 1.5, 0.1).point;
      const c = laneAt(roll, 2.5, 0.9).point;
      // Down at a, through b, up at c.
      lane.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: a.x, clientY: a.y, button: 0, buttons: 1, pointerId: 1, altKey: true }));
      lane.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: b.x, clientY: b.y, buttons: 1, pointerId: 1, altKey: true }));
      lane.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: c.x, clientY: c.y, buttons: 1, pointerId: 1, altKey: true }));
      lane.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: c.x, clientY: c.y, pointerId: 1, altKey: true }));
      // The first and last notes are outside the stroke; the middle two are
      // halfway along its two legs, at 0.5.
      expect(midi(roll.notes())).toEqual([102, 64, 64, 102]);
    });
  });

  test("Select mode: a box drawn over notes selects them, and Delete removes them", async () => {
    const roll = renderRoll({ notes: [note("C4", 0), note("E4", 0.5), note("G4", 2)] });
    await roll.screen.getByRole("button", { name: "Select" }).click();
    roll.dragOnGrid([1.4, 66], [0.05, 59]);
    await userEvent.keyboard("{Delete}");
    expect(roll.notes()).toEqual([note("G4", 2)]);
  });

  test("copy a note and paste it at the insert marker, twice", async () => {
    const roll = renderRoll({ notes: [note("C4", 0)] });
    await userEvent.click(roll.noteAt(0));
    await userEvent.keyboard("{Control>}c{/Control}");
    // The marker goes where the ruler is clicked.
    const ruler = roll.screen.getByTitle(/^Click to place the insert marker/);
    await userEvent.click(ruler, { position: { x: Math.round(1 * roll.pxPerSecond() + 2), y: 5 } });
    await userEvent.keyboard("{Control>}v{/Control}");
    expect(roll.notes()).toEqual([note("C4", 0), note("C4", 1)]);
    // Each paste moves the marker on past what it pasted.
    await userEvent.keyboard("{Control>}v{/Control}");
    expect(roll.notes()).toEqual([note("C4", 0), note("C4", 1), note("C4", 1.5)]);
  });
});

describe("playing", () => {
  test("Space plays, and pauses while playing", async () => {
    const roll = renderRoll();
    await userEvent.keyboard(" ");
    expect(roll.onPlay).toHaveBeenCalledOnce();
    roll.screen.rerender(
      <PianoRollEditor
        channelName="Lead"
        color={TRACK_COLOR_PALETTE[0]}
        notes={[]}
        length={4}
        bpm={120}
        beatsPerBar={4}
        offset={0}
        scaleSetting={{ root: "C", scale: "major", enabled: false }}
        onScaleChange={vi.fn()}
        onChange={roll.onChange}
        onClose={vi.fn()}
        onPreviewNote={vi.fn()}
        isPlaying
        onPlay={roll.onPlay}
        onPause={roll.onPause}
      />
    );
    await userEvent.keyboard(" ");
    expect(roll.onPause).toHaveBeenCalledOnce();
  });

  // A long clip, zoomed all the way in, so it's many views wide.
  test("with Follow on, the view turns a page when the playhead runs off it", async () => {
    const roll = renderRoll({ length: 32, isPlaying: true });
    const view = await roll.zoomIn();
    expect(view).toBeLessThan(4);

    transport.seconds = view / 2;
    await nextFrame();
    await nextFrame();
    expect(roll.grid.scrollLeft).toBe(0);
    // Past the right edge: the playhead lands near the left edge again.
    transport.seconds = view + 0.1;
    await expect.poll(() => roll.grid.scrollLeft).toBeCloseTo((view + 0.1) * roll.pxPerSecond() - 8, 0);
  });

  test("scrolled away from the playhead, the view stays put", async () => {
    const roll = renderRoll({ length: 32, isPlaying: true });
    const view = await roll.zoomIn();
    transport.seconds = 0.2;
    await nextFrame();
    await nextFrame();
    // Scrolled to the clip's end while the playhead is in view; it plays on
    // past where the view was.
    roll.grid.scrollLeft = roll.grid.scrollWidth;
    const away = roll.grid.scrollLeft;
    transport.seconds = view + 0.5;
    await nextFrame();
    await nextFrame();
    expect(roll.grid.scrollLeft).toBe(away);
  });

  test("with Follow off, the view stays put", async () => {
    const roll = renderRoll({ length: 32, isPlaying: true });
    const view = await roll.zoomIn();
    await roll.screen.getByRole("button", { name: "Follow" }).click();
    transport.seconds = 0.2;
    await nextFrame();
    transport.seconds = view + 0.5;
    await nextFrame();
    await nextFrame();
    expect(roll.grid.scrollLeft).toBe(0);
    // Follow is remembered for the next clip opened: back on.
    await roll.screen.getByRole("button", { name: "Follow" }).click();
  });
});
