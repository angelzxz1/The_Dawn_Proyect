"use client";

import { useEffect, useRef, useState } from "react";
import { audioEngine } from "@/engine/audioEngine";

/** The count-in as it goes, by the transport's clock: the beats left
 * before recording starts (4, 3, 2, 1), the bar's first beat brighter.
 * Nothing the rest of the time. */
export function CountIn({ beatsPerBar }: { beatsPerBar: number }) {
  const [left, setLeft] = useState<number | null>(null);
  // Read every frame, but only redrawn when the count changes.
  const shown = useRef<number | null>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const now = audioEngine.getCountInLeft();
      if (now !== shown.current) {
        shown.current = now;
        setLeft(now);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  if (left === null) return null;
  const perBar = Math.max(1, Math.round(beatsPerBar));
  // The bar's first beat: the count left is a whole number of bars.
  const downbeat = left % perBar === 0;
  return (
    <div
      role="timer"
      aria-label={`Count-in: ${left} beat${left === 1 ? "" : "s"} to go`}
      className="flex items-center gap-1.5 rounded-md border border-record/60 bg-record/15 px-2 py-0.5"
    >
      <span className="text-[10px] uppercase tracking-wide text-record">Count-in</span>
      <span className={`min-w-[1.5ch] text-center font-mono text-lg font-bold leading-none ${downbeat ? "text-white" : "text-record"}`}>{left}</span>
    </div>
  );
}
