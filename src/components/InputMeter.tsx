"use client";

import { useEffect, useRef, useState } from "react";
import { audioEngine } from "@/lib/audioEngine";

const CLIP = 0.989; // about -0.1 dBFS
const FLOOR_DB = -60;
const toFraction = (peak: number) => (peak <= 0 ? 0 : Math.max(0, Math.min(1, 1 - (20 * Math.log10(peak)) / FLOOR_DB)));

/** The input level on an armed audio track: a horizontal meter from -60 to
 * 0 dBFS with a mark at -12 dBFS (a good peak for recording) and a clip
 * light that stays on until clicked. */
export function InputMeter() {
  const fill = useRef<HTMLDivElement>(null);
  const hold = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let frame = 0;
    let held = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const peak = audioEngine.getInputPeak();
      setOpen(peak !== null);
      const level = toFraction(peak ?? 0);
      held = Math.max(level, held - 0.5 * dt);
      if (fill.current) fill.current.style.clipPath = `inset(0 ${(1 - level) * 100}% 0 0)`;
      if (hold.current) hold.current.style.left = `calc(${held * 100}% - 1px)`;
      if ((peak ?? 0) >= CLIP) setClipped(true);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-1 px-1"
      title={open ? "Input level: aim for peaks around the mark (-12 dB); the light turns red if it clips (click it to reset)" : "Waiting for the input…"}
    >
      <div className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-sm border border-border bg-black/50" role="img" aria-label="Input level meter">
        <div
          ref={fill}
          className="absolute inset-0"
          style={{ clipPath: "inset(0 100% 0 0)", background: "linear-gradient(to right, #4ade80 0%, #4ade80 70%, #facc15 85%, #ff5a5a 100%)" }}
        />
        <div ref={hold} className="absolute top-0 h-full w-[2px] bg-white/80" style={{ left: "-2px" }} />
        {/* -12 dBFS */}
        <div className="absolute top-0 h-full w-px bg-white/35" style={{ left: `${toFraction(Math.pow(10, -12 / 20)) * 100}%` }} />
      </div>
      <button
        type="button"
        aria-label={clipped ? "Input clipped - click to reset" : "Clip light"}
        onClick={(e) => {
          e.stopPropagation();
          setClipped(false);
        }}
        className="h-2 w-2 shrink-0 rounded-full border border-border"
        style={{ background: clipped ? "#ff5a5a" : "transparent" }}
      />
    </div>
  );
}
