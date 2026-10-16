import { Midi } from "@tonejs/midi";
import type { NoteEvent } from "../project/types";
import { beatAtSeconds, type TempoMap } from "../project/tempoMap";

/**
 * Parses a standard MIDI file into a flat list of note events (all tracks
 * merged), timed in beats (quarter notes) from the file's start rather than
 * in seconds: a file's own tempo (and its tempo changes) has nothing to do
 * with this project's, so the notes land on the beats they were written on
 * and the caller places them on the project's tempo map
 * (tempoEdits.ts notesAtBeats).
 */
export async function parseMidiFile(file: File): Promise<NoteEvent[]> {
  const buffer = await file.arrayBuffer();
  const midi = new Midi(buffer);
  const ppq = midi.header.ppq || 480;
  const notes: NoteEvent[] = [];
  midi.tracks.forEach((track) => {
    track.notes.forEach((note) => {
      notes.push({
        note: note.name,
        time: note.ticks / ppq,
        duration: note.durationTicks / ppq,
        velocity: note.velocity,
      });
    });
  });
  return notes.sort((a, b) => a.time - b.time);
}

/** Encodes notes (in seconds from `origin` on the timeline) as a standard
 * MIDI file with the project's tempo map from there, and returns it as a
 * downloadable Blob. */
export function encodeMidiFile(notes: NoteEvent[], trackName: string, tempo: TempoMap, origin = 0): Blob {
  const midi = new Midi();
  const ppq = midi.header.ppq;
  const from = beatAtSeconds(tempo, origin);
  const ticksAt = (seconds: number) => Math.max(0, Math.round((beatAtSeconds(tempo, seconds) - from) * ppq));
  // The tempo where the file starts, then the changes after it.
  let bpm = tempo.segments[0].bpm;
  tempo.segments.forEach((s) => {
    if (s.beat <= from + 1e-9) bpm = s.bpm;
  });
  midi.header.tempos = [
    { ticks: 0, bpm },
    ...tempo.segments.filter((s) => s.beat > from + 1e-9).map((s) => ({ ticks: Math.round((s.beat - from) * ppq), bpm: s.bpm })),
  ];
  midi.header.update();
  midi.header.name = trackName;
  const track = midi.addTrack();
  track.name = trackName;
  notes.forEach((note) => {
    const ticks = ticksAt(origin + note.time);
    track.addNote({
      name: note.note,
      ticks,
      durationTicks: Math.max(1, ticksAt(origin + note.time + note.duration) - ticks),
      velocity: note.velocity,
    });
  });
  return new Blob([new Uint8Array(midi.toArray())], { type: "audio/midi" });
}

export function downloadMidiFile(notes: NoteEvent[], trackName: string, tempo: TempoMap, origin = 0): void {
  const blob = encodeMidiFile(notes, trackName, tempo, origin);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${trackName.replace(/\s+/g, "-").toLowerCase() || "clip"}.mid`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
