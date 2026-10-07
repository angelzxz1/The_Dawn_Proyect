// Drum pad names by note, for the piano roll and the on-screen pads: a
// General-MIDI-ish map (Ableton's Drum Rack uses the same neighborhood), so
// an imported/exported .mid drum pattern lines up with other software too.

import { PAD_COUNT, defaultKitPads, padNote, type DrumKitParams } from "./drumParams";

export interface DrumPadDef {
  note: string;
  midi: number;
  label: string;
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

/** The 16 pads of a kit (or the default kit), in note order. */
export function drumPads(kit?: DrumKitParams): DrumPadDef[] {
  const pads = kit?.pads ?? defaultKitPads();
  return Array.from({ length: PAD_COUNT }, (_, i) => ({ note: noteName(padNote(i)), midi: padNote(i), label: pads[i]?.name ?? `Pad ${i + 1}` }));
}

export const DRUM_PADS: DrumPadDef[] = drumPads();

export function drumLabelForNote(note: string, kit?: DrumKitParams): string | undefined {
  return (kit ? drumPads(kit) : DRUM_PADS).find((p) => p.note === note)?.label;
}
