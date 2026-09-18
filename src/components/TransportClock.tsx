"use client";

import { useEffect, useRef } from "react";
import { audioEngine } from "@/lib/audioEngine";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, "0")}.${ms}`;
}

/** Renders the transport time, updating itself via rAF without re-rendering React. */
export function TransportClock() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let frame: number;
    const tick = () => {
      if (ref.current) {
        ref.current.textContent = formatTime(audioEngine.getTransportSeconds());
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <span ref={ref} className="font-mono text-sm text-muted">
      0:00.0
    </span>
  );
}
