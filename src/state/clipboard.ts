// Module-level clipboard for copy/paste across the piano roll editor and the
// arrangement view. Plain in-memory state (not React state) is enough here -
// it's client-only, single-user, and doesn't need to trigger re-renders.

import type { AudioWarp, ClipInstance, NoteEvent } from "../project/types";

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
export type ClipboardClip = (
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
      warp?: AudioWarp;
    }
) & {
  /** The clip's name and color, which the pasted one has too. */
  name?: string;
  color?: string;
};

let clipClipboard: ClipboardClip | null = null;

export function copyClip(data: ClipboardClip): void {
  clipClipboard =
    data.kind === "midi"
      ? { ...data, notes: data.notes.map((n) => ({ ...n })) }
      : { ...data };
  rangeClipboard = null;
}

/** The clip copied last, unless a time range was copied after it. */
export function getCopiedClip(): ClipboardClip | null {
  return clipClipboard;
}

/** A time range copied from some tracks (rangeActions.ts): each track's
 * clips in it, placed from its start, and the audio they play, by URL. */
export interface ClipboardRange {
  length: number;
  /** The lanes it was selected on (a group's lane for its tracks). */
  lanes: string[];
  tracks: { channelId: string; clips: ClipInstance[] }[];
  audio: Map<string, Blob>;
}

let rangeClipboard: ClipboardRange | null = null;

export function copyRange(range: ClipboardRange): void {
  rangeClipboard = range;
  clipClipboard = null;
}

/** The time range copied last, unless a clip was copied after it. */
export function getCopiedRange(): ClipboardRange | null {
  return rangeClipboard;
}
