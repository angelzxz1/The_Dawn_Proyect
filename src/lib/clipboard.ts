// Module-level clipboard for copy/paste across the piano roll editor and the
// arrangement view. Plain in-memory state (not React state) is enough here -
// it's client-only, single-user, and doesn't need to trigger re-renders.

import type { NoteEvent } from "./types";

let noteClipboard: NoteEvent[] | null = null;

export function copyNotes(notes: NoteEvent[]): void {
  noteClipboard = notes.map((n) => ({ ...n }));
}

export function getCopiedNotes(): NoteEvent[] | null {
  return noteClipboard;
}

/** A copied clip is either a MIDI clip's notes or an audio clip's decoded
 * file - the arrangement view's clipboard handles both, branching the same
 * way the clip context menu already does. */
export type ClipboardClip =
  | { kind: "midi"; notes: NoteEvent[]; length: number; loopLength?: number | null }
  | {
      kind: "audio";
      url: string;
      fileName: string;
      durationSeconds: number;
      peaks: number[];
      length: number;
      sourceOffset: number;
      fadeIn: number;
      fadeOut: number;
      gainDb: number;
      loopLength?: number | null;
    };

let clipClipboard: ClipboardClip | null = null;

export function copyClip(data: ClipboardClip): void {
  clipClipboard =
    data.kind === "midi"
      ? { ...data, notes: data.notes.map((n) => ({ ...n })) }
      : { ...data };
}

export function getCopiedClip(): ClipboardClip | null {
  return clipClipboard;
}
