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

interface ClipClipboard {
  notes: NoteEvent[];
  length: number;
}

let clipClipboard: ClipClipboard | null = null;

export function copyClip(data: ClipClipboard): void {
  clipClipboard = { notes: data.notes.map((n) => ({ ...n })), length: data.length };
}

export function getCopiedClip(): ClipClipboard | null {
  return clipClipboard;
}
