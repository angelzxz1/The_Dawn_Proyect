// How knobs respond to the mouse: dragging, the wheel, and Shift for fine
// control. Every knob (plugin knobs, the synth's, the track bars) shares
// these numbers, so they all feel the same.

/** Shift makes a drag or a wheel turn this much finer. */
export const FINE_FACTOR = 0.1;

/** One wheel notch turns a knob this far (of its whole sweep). */
export const WHEEL_STEP = 0.02;

/** A browser's usual pixels per wheel notch. */
const PX_PER_NOTCH = 100;

export interface WheelLike {
  deltaX: number;
  deltaY: number;
  /** 0 pixels, 1 lines, 2 pages (WheelEvent.deltaMode). */
  deltaMode: number;
  shiftKey: boolean;
}

/** How far a wheel event turns a knob, as a fraction of its sweep (up or
 * away from you is positive). Shift turns it finely; browsers send
 * Shift+wheel as a sideways scroll, so that's read too. A plain sideways
 * swipe (trackpad) returns 0, so it still scrolls the page. */
export function wheelTurn(e: WheelLike): number {
  const raw = e.deltaY !== 0 ? e.deltaY : e.shiftKey ? e.deltaX : 0;
  if (raw === 0) return 0;
  const px = e.deltaMode === 1 ? raw * 33 : e.deltaMode === 2 ? raw * 400 : raw;
  // A fast spin can arrive as one big event: cap it at three notches.
  const notches = Math.max(-3, Math.min(3, -px / PX_PER_NOTCH));
  return notches * WHEEL_STEP * (e.shiftKey ? FINE_FACTOR : 1);
}

/** Wheel turns this close together count as one gesture (one undo step). */
export const WHEEL_GESTURE_MS = 600;
