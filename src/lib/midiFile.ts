import { Midi } from "@tonejs/midi";
import type { NoteEvent } from "./types";

/** Parses a standard MIDI file into a flat list of note events (all tracks merged). */
export async function parseMidiFile(file: File): Promise<NoteEvent[]> {
  const buffer = await file.arrayBuffer();
  const midi = new Midi(buffer);
  const notes: NoteEvent[] = [];
  midi.tracks.forEach((track) => {
    track.notes.forEach((note) => {
      notes.push({
        note: note.name,
        time: note.time,
        duration: note.duration,
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
