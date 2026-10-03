"use client";

import { useEffect, useRef, type RefObject } from "react";
import { WHEEL_GESTURE_MS, wheelTurn } from "@/lib/knobInput";

/** Turns a knob with the mouse wheel while the pointer is over it (Shift
 * for fine). `onTurn` gets the new position (0..1) along the knob's sweep,
 * and `fresh` is true for the first turn of a gesture (for undo). Several
 * quick turns accumulate even before the knob re-renders. */
export function useKnobWheel(
  ref: RefObject<HTMLElement | null>,
  position: number,
  onTurn: (position: number, fresh: boolean) => void,
  enabled = true
) {
  const latest = useRef({ position, onTurn });
  const gesture = useRef<{ position: number; at: number } | null>(null);
  useEffect(() => {
    latest.current = { position, onTurn };
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const onWheel = (e: WheelEvent) => {
      const turn = wheelTurn(e);
      if (turn === 0) return;
      e.preventDefault();
      const now = performance.now();
      const g = gesture.current;
      const fresh = !g || now - g.at > WHEEL_GESTURE_MS;
      const next = Math.min(1, Math.max(0, (fresh ? latest.current.position : g.position) + turn));
      gesture.current = { position: next, at: now };
      latest.current.onTurn(next, fresh);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref, enabled]);
}
