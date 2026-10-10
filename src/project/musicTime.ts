// Musical time: bars and the snap grid, in seconds at a given tempo.
// Shared by the arrangement, the engine and the project's saved settings.

/** Quarter-note-equivalent beats per bar for an x/y time signature. */
export function quarterNotesPerBar(numerator: number, denominator: number): number {
  return (numerator * 4) / denominator;
}

export function secondsPerBar(bpm: number, beatsPerBar: number): number {
  return (60 / bpm) * beatsPerBar;
}

/** Rounds a duration up to the next bar boundary (minimum one bar). */
export function roundUpToBar(
  seconds: number,
  bpm: number,
  beatsPerBar: number
): number {
  const bar = secondsPerBar(bpm, beatsPerBar);
  return Math.max(bar, Math.ceil(seconds / bar) * bar);
}

/** User-facing grid resolution for dragging/placing clips - independent of
 * zoom, unlike `snapUnitFor`. "off" means free positioning (no snapping). */
export type SnapResolution = "off" | "bar" | "1/2" | "1/4" | "1/8" | "1/16";

export const SNAP_RESOLUTIONS: SnapResolution[] = ["off", "bar", "1/2", "1/4", "1/8", "1/16"];

export const SNAP_RESOLUTION_LABELS: Record<SnapResolution, string> = {
  off: "Off",
  bar: "1 Bar",
  "1/2": "1/2",
  "1/4": "1/4",
  "1/8": "1/8",
  "1/16": "1/16",
};

/** Grid size in seconds for a snap resolution - 0 means "off" (free). Note
 * values are quarter-note-relative, independent of the time signature's
 * numerator; "bar" uses the actual bar length for the current signature. */
export function snapSecondsForResolution(
  resolution: SnapResolution,
  bpm: number,
  beatsPerBar: number
): number {
  const quarter = 60 / bpm;
  switch (resolution) {
    case "off":
      return 0;
    case "bar":
      return secondsPerBar(bpm, beatsPerBar);
    case "1/2":
      return quarter * 2;
    case "1/4":
      return quarter;
    case "1/8":
      return quarter / 2;
    case "1/16":
      return quarter / 4;
  }
}
