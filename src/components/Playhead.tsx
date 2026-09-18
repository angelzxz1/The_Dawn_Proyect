"use client";

import { useEffect, useRef } from "react";
import { audioEngine } from "@/lib/audioEngine";

interface PlayheadProps {
  pxPerSecond: number;
  /** Total height to span, from the top of the ruler through the last track lane. */
  height: number;
}

/** A playhead line that updates itself via rAF, without triggering React re-renders. */
export function Playhead({ pxPerSecond, height }: PlayheadProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame: number;
    const tick = () => {
      if (ref.current) {
        const x = audioEngine.getTransportSeconds() * pxPerSecond;
        ref.current.style.transform = `translateX(${x}px)`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [pxPerSecond]);

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute left-0 top-0 z-20 w-px bg-record"
      style={{ height }}
    >
      <div className="absolute -left-[3px] top-0 h-2 w-2 rounded-full bg-record" />
    </div>
  );
}
