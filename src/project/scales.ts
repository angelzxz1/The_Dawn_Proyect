// Scale definitions and a helper for highlighting in-scale notes, the way
// Ableton's "Highlight Scale" feature tints matching keys.

export const SCALE_ROOTS = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

export const SCALES: Record<string, number[]> = {
  Major: [0, 2, 4, 5, 7, 9, 11],
  "Natural Minor": [0, 2, 3, 5, 7, 8, 10],
  Dorian: [0, 2, 3, 5, 7, 9, 10],
  Phrygian: [0, 1, 3, 5, 7, 8, 10],
  Lydian: [0, 2, 4, 6, 7, 9, 11],
  Mixolydian: [0, 2, 4, 5, 7, 9, 10],
  Locrian: [0, 1, 3, 5, 6, 8, 10],
  "Major Pentatonic": [0, 2, 4, 7, 9],
  "Minor Pentatonic": [0, 3, 5, 7, 10],
  Chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export const SCALE_NAMES = Object.keys(SCALES);

export interface ScaleSetting {
  root: string;
  scale: string;
  enabled: boolean;
}

export function isNoteInScale(midi: number, setting: ScaleSetting): boolean {
  if (!setting.enabled) return true;
  const intervals = SCALES[setting.scale];
  if (!intervals) return true;
  const rootIndex = SCALE_ROOTS.indexOf(
    setting.root as (typeof SCALE_ROOTS)[number]
  );
  if (rootIndex < 0) return true;
  const pitchClass = ((midi % 12) + 12) % 12;
  const relative = ((pitchClass - rootIndex) % 12 + 12) % 12;
  return intervals.includes(relative);
}
