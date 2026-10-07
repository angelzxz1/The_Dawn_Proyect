// The DAW's "document" state - everything undo/redo and save/load need to
// fully reconstruct the project. (engineSync.ts makes the live engine
// match it.)

import type {
  BusConfig,
  ChannelConfig,
  ClipInstance,
  MidiClipInstance,
  NoteEvent,
  TimeSignature,
} from "./types";
import type { EffectInstance } from "../effects/registry";

export interface ProjectState {
  channels: ChannelConfig[];
  clipsByChannel: Record<string, ClipInstance[]>;
  channelEffects: Record<string, EffectInstance[]>;
  buses: BusConfig[];
  busEffects: Record<string, EffectInstance[]>;
  bpm: number;
  timeSignature: TimeSignature;
  masterVolume: number;
  masterPan: number;
  masterName: string;
  masterEffects: EffectInstance[];
}

/** A MIDI clip's notes clamped to its own length - matches what the clip
 * box visually shows (ClipBlock hides anything at/after `length`), so
 * playback never sounds a note the clip's boundary already hides it
 * behind. When the clip is looping (`loopLength` set and shorter than
 * `length`), the note pattern within that first `loopLength` window tiles
 * to fill the rest of the box instead. Used by the engine (engineSync.ts)
 * and the export. */
export function notesWithinClip(clip: MidiClipInstance): NoteEvent[] {
  const unit = clip.loopLength && clip.loopLength > 0 ? clip.loopLength : clip.length;
  const clampToUnit = (n: NoteEvent) => ({ ...n, duration: Math.min(n.duration, unit - n.time) });
  const unitNotes = clip.notes.filter((n) => n.time < unit).map(clampToUnit);

  if (unit >= clip.length) {
    return unitNotes
      .filter((n) => n.time < clip.length)
      .map((n) => ({ ...n, duration: Math.min(n.duration, clip.length - n.time) }));
  }

  const tiled: NoteEvent[] = [];
  for (let start = 0; start < clip.length; start += unit) {
    unitNotes.forEach((n) => {
      const time = start + n.time;
      if (time < clip.length) {
        tiled.push({ ...n, time, duration: Math.min(n.duration, clip.length - time) });
      }
    });
  }
  return tiled;
}
