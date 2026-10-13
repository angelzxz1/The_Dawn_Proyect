// The arrangement's edit tools, like Logic's or FL Studio's: what a click or
// a drag on a lane or a clip does. The pointer selects, moves and resizes;
// split cuts a clip where it's clicked; draw makes a MIDI clip on an empty
// lane; erase deletes clips clicked or dragged across; slip slides what's
// inside a clip while the clip stays put. Shift+1…5 picks one (the letters
// and numbers alone play notes), Esc goes back to the pointer.

export type ClipTool = "pointer" | "split" | "draw" | "erase" | "slip";

export interface ClipToolInfo {
  id: ClipTool;
  label: string;
  /** Its shortcut, as useShortcuts reads it. */
  keys: string;
  /** What it does, for its button's tooltip. */
  hint: string;
}

export const CLIP_TOOLS: ClipToolInfo[] = [
  { id: "pointer", label: "Pointer", keys: "shift+1", hint: "Select, move and resize clips" },
  { id: "split", label: "Split", keys: "shift+2", hint: "Click a clip to cut it in two there" },
  { id: "draw", label: "Draw", keys: "shift+3", hint: "Click or drag on an empty MIDI lane to draw a clip" },
  { id: "erase", label: "Erase", keys: "shift+4", hint: "Click a clip, or drag across clips, to delete them" },
  { id: "slip", label: "Slip", keys: "shift+5", hint: "Drag inside a clip to slide its notes or audio; the clip stays put" },
];

/** "Shift+1" for "shift+1". */
export function shortcutLabel(keys: string): string {
  return keys
    .split("+")
    .map((k) => k[0].toUpperCase() + k.slice(1))
    .join("+");
}

/** A cursor drawn from an icon's SVG paths (24×24, lucide's), white with a
 * dark outline so it shows on any clip color. */
function iconCursor(paths: string, hotX: number, hotY: number, fallback: string): string {
  const stroke = (color: string, width: number) =>
    `<g fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${stroke("#000", 4)}${stroke("#fff", 2)}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotX} ${hotY}, ${fallback}`;
}

const SCISSORS =
  '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>';
const PENCIL =
  '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>';
const ERASER =
  '<path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.828 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"/><path d="m5.082 11.09 8.828 8.828"/>';

/** The pointer's look over a lane or clip with each tool. */
export const TOOL_CURSORS: Record<Exclude<ClipTool, "pointer">, string> = {
  split: iconCursor(SCISSORS, 12, 12, "crosshair"),
  draw: iconCursor(PENCIL, 2, 22, "crosshair"),
  erase: iconCursor(ERASER, 4, 20, "not-allowed"),
  slip: "ew-resize",
};
