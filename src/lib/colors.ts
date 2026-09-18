// A small track-color palette, cycled per channel like Reaper/Ableton track colors.

export interface TrackColor {
  accent: string; // clip fill / accent border
  accentSoft: string; // subtle background tint
}

const PALETTE: TrackColor[] = [
  { accent: "#5eb1ff", accentSoft: "rgba(94,177,255,0.16)" },
  { accent: "#ff9d5e", accentSoft: "rgba(255,157,94,0.16)" },
  { accent: "#8ee27d", accentSoft: "rgba(142,226,125,0.16)" },
  { accent: "#e37dff", accentSoft: "rgba(227,125,255,0.16)" },
  { accent: "#ffe45e", accentSoft: "rgba(255,228,94,0.16)" },
  { accent: "#7dd6e2", accentSoft: "rgba(125,214,226,0.16)" },
  { accent: "#ff7d9d", accentSoft: "rgba(255,125,157,0.16)" },
  { accent: "#a3a8ff", accentSoft: "rgba(163,168,255,0.16)" },
];

export function trackColorForIndex(index: number): TrackColor {
  return PALETTE[index % PALETTE.length];
}

/** Neutral color for the Master bus row, distinct from any track's color. */
export const MASTER_COLOR: TrackColor = {
  accent: "#c7c9d1",
  accentSoft: "rgba(199,201,209,0.16)",
};
