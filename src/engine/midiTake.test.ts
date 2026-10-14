import { describe, expect, it } from "vitest";
import { MidiTake } from "./midiTake";

describe("a MIDI take", () => {
  it("times notes from the take's start and closes held notes at the end", () => {
    let now = 0;
    const take = new MidiTake("ch", 4, 10, () => now);
    now = 0.5;
    take.noteOn("C4", 0.8, 10.5);
    now = 1;
    take.noteOn("E4", 0.6, 11);
    now = 1.25;
    take.noteOff("C4");
    expect(take.preview().notes).toEqual([{ note: "C4", time: 0.5, duration: 0.75, velocity: 0.8 }]);
    expect(take.preview().held).toEqual([{ note: "E4", time: 1, duration: 0.25, velocity: 0.6 }]);
    now = 2;
    expect(take.heldNotes).toEqual(["E4"]);
    expect(take.finish()).toEqual([
      { note: "C4", time: 0.5, duration: 0.75, velocity: 0.8 },
      { note: "E4", time: 1, duration: 1, velocity: 0.6 },
    ]);
  });

  it("ignores the count-in, except a note just ahead of the downbeat", () => {
    let now = -0.5;
    const take = new MidiTake("ch", 0, 10, () => now);
    take.noteOn("C4", 1, 9.5); // half a second early: count-in
    now = -0.05;
    take.noteOn("D4", 1, 9.95); // 50 ms early: on the downbeat
    now = 0.2;
    take.noteOff("C4");
    take.noteOff("D4");
    expect(take.finish()).toEqual([{ note: "D4", time: 0, duration: 0.2, velocity: 1 }]);
  });

  it("gives very short notes a minimum length", () => {
    const now = 1;
    const take = new MidiTake("ch", 0, 0, () => now);
    take.noteOn("C4", 1, 1);
    take.noteOff("C4");
    expect(take.finish()[0].duration).toBe(0.05);
  });
});
