// A General-MIDI-ish drum map (Ableton's stock Drum Rack uses the same
// neighborhood), so an imported/exported .mid drum pattern lines up with
// other software too.

export interface DrumPadDef {
  note: string;
  label: string;
}

export const DRUM_PADS: DrumPadDef[] = [
  { note: "C1", label: "Kick" },
  { note: "D1", label: "Snare" },
  { note: "E1", label: "Clap" },
  { note: "F1", label: "Low Tom" },
  { note: "G1", label: "Mid Tom" },
  { note: "A1", label: "High Tom" },
  { note: "F#1", label: "Closed Hat" },
  { note: "A#1", label: "Open Hat" },
  { note: "C#2", label: "Crash" },
  { note: "D#2", label: "Ride" },
];

const DRUM_LABEL_BY_NOTE: Record<string, string> = Object.fromEntries(
  DRUM_PADS.map((p) => [p.note, p.label])
);

export function drumLabelForNote(note: string): string | undefined {
  return DRUM_LABEL_BY_NOTE[note];
}
