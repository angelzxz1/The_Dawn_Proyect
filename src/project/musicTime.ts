// Musical time: bars and the snap grid, in beats (quarter notes) - the
// tempo map (tempoMap.ts) says where they fall in seconds. Shared by the
// arrangement, the engine and the project's saved settings.

/** Quarter-note-equivalent beats per bar for an x/y time signature. */
export function quarterNotesPerBar(numerator: number, denominator: number): number {
  return (numerator * 4) / denominator;
}

/** User-facing grid resolution for dragging/placing clips. "auto" follows
 * the zoom (the finest grid line drawn, `snapUnitFor`, as the ruler and the
 * loop snap); the others are fixed. "off" means free positioning (no
 * snapping). */
export type SnapResolution = "off" | "auto" | "bar" | "1/2" | "1/4" | "1/8" | "1/16";

export const SNAP_RESOLUTIONS: SnapResolution[] = ["off", "auto", "bar", "1/2", "1/4", "1/8", "1/16"];

export const SNAP_RESOLUTION_LABELS: Record<SnapResolution, string> = {
  off: "Off",
  auto: "Adaptive",
  bar: "1 Bar",
  "1/2": "1/2",
  "1/4": "1/4",
  "1/8": "1/8",
  "1/16": "1/16",
};

/** Grid size in beats (quarter notes) for a snap resolution - 0 means
 * "off" (free); "bar" is the bar for the current signature; "auto" is
 * `adaptiveBeats` (what the zoom shows). With a tempo map (tempoMap.ts
 * makeGrid) the grid follows the tempo changes. */
export function snapBeatsForResolution(resolution: SnapResolution, beatsPerBar: number, adaptiveBeats = beatsPerBar): number {
  switch (resolution) {
    case "off":
      return 0;
    case "auto":
      return adaptiveBeats;
    case "bar":
      return beatsPerBar;
    case "1/2":
      return 2;
    case "1/4":
      return 1;
    case "1/8":
      return 0.5;
    case "1/16":
      return 0.25;
  }
}
