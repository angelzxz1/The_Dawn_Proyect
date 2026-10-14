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

/** A "#rrggbb" color the user picked themselves. */
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const fromHex = new Map<string, TrackColor>();

/** A track color from any "#rrggbb" - the same object each time for the
 * same color, like the palette's, so a memoized track row sees it as
 * unchanged. */
export function trackColorFromHex(hex: string): TrackColor {
  const key = hex.toLowerCase();
  let color = fromHex.get(key);
  if (!color) {
    const n = parseInt(key.slice(1), 16);
    color = { accent: key, accentSoft: `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0.16)` };
    fromHex.set(key, color);
  }
  return color;
}

/** What the color picker chose: a palette slot, or any "#rrggbb". */
export type TrackColorPick = { colorIndex: number } | { color: string };

/** A track's or bus's color: the one picked from the color wheel if any,
 * else its palette slot. */
export function trackColorOf(item: { colorIndex: number; color?: string }): TrackColor {
  return item.color && HEX_COLOR.test(item.color) ? trackColorFromHex(item.color) : trackColorForIndex(item.colorIndex);
}

/** The full palette, in order - for a color-swatch picker letting a track
 * be explicitly recolored rather than just cycling by creation order. */
export const TRACK_COLOR_PALETTE: TrackColor[] = PALETTE;

/** Neutral color for the Master bus row, distinct from any track's color. */
export const MASTER_COLOR: TrackColor = {
  accent: "#c7c9d1",
  accentSoft: "rgba(199,201,209,0.16)",
};
