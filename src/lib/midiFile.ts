import { Midi } from "@tonejs/midi";
import type { NoteEvent } from "./types";

/**
 * Parses a standard MIDI file into a flat list of note events (all tracks
 * merged). `@tonejs/midi` reports each note's `time`/`duration` in seconds
 * computed from the FILE's own embedded tempo, which has nothing to do with
 * this project's tempo - every other note time in the app is stored in
 * seconds-at-the-project's-current-bpm, so importing a file authored at a
 * different tempo without correcting for that would play it at the wrong
 * speed (too fast/slow, and out of sync with the grid). `projectBpm`
 * rescales the parsed times so the imported clip lands on the same beats
 * it was written on, just timed to this project's tempo instead of the
 * file's - assumes a single, constant tempo, which covers the vast
 * majority of real-world MIDI files (mid-file tempo ramps aren't
 * corrected beat-for-beat).
 */
export async function parseMidiFile(file: File, projectBpm: number): Promise<NoteEvent[]> {
  const buffer = await file.arrayBuffer();
  const midi = new Midi(buffer);
  const fileBpm = midi.header.tempos[0]?.bpm ?? projectBpm;
  const ratio = fileBpm / projectBpm;
  const notes: NoteEvent[] = [];
  midi.tracks.forEach((track) => {
    track.notes.forEach((note) => {
      notes.push({
        note: note.name,
        time: note.time * ratio,
        duration: note.duration * ratio,
        velocity: note.velocity,
      });
    });
  });
  return notes.sort((a, b) => a.time - b.time);
}

/** Encodes a clip as a standard MIDI file and returns it as a downloadable Blob. */
export function encodeMidiFile(
  notes: NoteEvent[],
  trackName: string,
  bpm: number
): Blob {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  midi.header.name = trackName;
  const track = midi.addTrack();
  track.name = trackName;
  notes.forEach((note) => {
    track.addNote({
      name: note.note,
      time: note.time,
      duration: note.duration,
      velocity: note.velocity,
    });
  });
  return new Blob([new Uint8Array(midi.toArray())], { type: "audio/midi" });
}

export function downloadMidiFile(
  notes: NoteEvent[],
  trackName: string,
  bpm: number
): void {
  const blob = encodeMidiFile(notes, trackName, bpm);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${trackName.replace(/\s+/g, "-").toLowerCase() || "clip"}.mid`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
