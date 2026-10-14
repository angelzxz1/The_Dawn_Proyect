// Tempo-synced note divisions for the Delay plugin's Time L/R knobs: while
// Sync is on, dragging or typing a time snaps to the nearest of these
// (dotted/triplet included), matching how a hardware/plugin delay's synced
// mode behaves - independent of the project's time signature, since a
// division is always relative to the beat (quarter note), not the bar.

export interface DelayDivision {
  label: string;
  /** Relative to a quarter note - e.g. 0.5 is an eighth note. */
  multiplier: number;
}

export const DELAY_DIVISIONS: DelayDivision[] = [
  { label: "1/32", multiplier: 0.125 },
  { label: "1/16T", multiplier: 1 / 6 },
  { label: "1/16", multiplier: 0.25 },
  { label: "1/16D", multiplier: 0.375 },
  { label: "1/8T", multiplier: 1 / 3 },
  { label: "1/8", multiplier: 0.5 },
  { label: "1/8D", multiplier: 0.75 },
  { label: "1/4T", multiplier: 2 / 3 },
  { label: "1/4", multiplier: 1 },
  { label: "1/4D", multiplier: 1.5 },
  { label: "1/2", multiplier: 2 },
  { label: "1/2D", multiplier: 3 },
  { label: "1/1", multiplier: 4 },
];

export function divisionSeconds(multiplier: number, bpm: number): number {
  return (60 / bpm) * multiplier;
}

/** The nearest note division to a raw seconds value, at the given tempo. */
export function nearestDivision(seconds: number, bpm: number): DelayDivision {
  let best = DELAY_DIVISIONS[0];
  let bestDistance = Infinity;
  for (const division of DELAY_DIVISIONS) {
    const distance = Math.abs(divisionSeconds(division.multiplier, bpm) - seconds);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = division;
    }
  }
  return best;
}

/** Snaps a raw seconds value to its nearest note division's exact seconds,
 * at the given tempo - used to quantize a Time L/R knob drag/type while
 * Sync is on. */
export function snapToDivision(seconds: number, bpm: number): number {
  return divisionSeconds(nearestDivision(seconds, bpm).multiplier, bpm);
}

/** The Time L/R knob readout while Sync is on: the nearest division's name
 * (e.g. "1/8D") rather than a raw millisecond value. */
export function formatDivision(seconds: number, bpm: number): string {
  return nearestDivision(seconds, bpm).label;
}
