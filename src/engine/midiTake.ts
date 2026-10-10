// A MIDI take being recorded: the notes played, timed from where the take
// starts. `clock` says how far into the take (s) "now" is.

import type { NoteEvent } from "../project/types";

const MIN_NOTE_DURATION = 0.05;

export class MidiTake {
  /** Notes down right now, by note name. */
  private readonly open = new Map<string, { time: number; velocity: number }>();
  /** Finished notes - only ever appended to, so the live preview can show
   * this list as is (copying a long take ~30 times a second is what made
   * recording lag as it went on). */
  private readonly events: NoteEvent[] = [];

  constructor(
    readonly channelId: string,
    /** Where on the timeline the take starts (s). */
    readonly from: number,
    /** Context time the transport starts at (after the count-in). */
    readonly startTime: number,
    private readonly clock: () => number
  ) {}

  noteOn(note: string, velocity: number, contextTime: number): void {
    // Notes from the count-in aren't part of the take, except one played
    // just ahead of the downbeat (it lands on it).
    if (contextTime < this.startTime - 0.1) return;
    this.open.set(note, { time: Math.max(0, this.clock()), velocity });
  }

  noteOff(note: string): void {
    const open = this.open.get(note);
    if (!open) return;
    this.open.delete(note);
    this.events.push({ note, time: open.time, duration: Math.max(this.clock() - open.time, MIN_NOTE_DURATION), velocity: open.velocity });
  }

  /** Closes the notes still held and returns the take, in time order. */
  finish(): NoteEvent[] {
    [...this.open.keys()].forEach((note) => this.noteOff(note));
    return this.events.sort((a, b) => a.time - b.time);
  }

  /** The take so far, for drawing it: finished notes and the ones held. */
  preview(): { notes: readonly NoteEvent[]; held: NoteEvent[] } {
    const now = this.clock();
    const held = [...this.open].map(([note, open]) => ({
      note,
      time: open.time,
      duration: Math.max(now - open.time, MIN_NOTE_DURATION),
      velocity: open.velocity,
    }));
    return { notes: this.events, held };
  }

  /** Notes currently held (to release them when the take ends). */
  get heldNotes(): string[] {
    return [...this.open.keys()];
  }
}
