"use client";

import { useMemo } from "react";
import { RULER_HEIGHT } from "@/lib/timeline";

interface TimelineRulerProps {
  bpm: number;
  totalSeconds: number;
  pxPerSecond: number;
  beatsPerBar: number;
  onSeek: (seconds: number) => void;
}

export function TimelineRuler({
  bpm,
  totalSeconds,
  pxPerSecond,
  beatsPerBar,
  onSeek,
}: TimelineRulerProps) {
  const secondsPerBeat = 60 / bpm;

  // Adaptive grid: bars always shown; beat subdivisions and their labels
  // fade in as you zoom in, the same way the piano roll editor's ruler does.
  const marks = useMemo(() => {
    const totalBeats = Math.ceil(totalSeconds / secondsPerBeat);
    const beatPx = secondsPerBeat * pxPerSecond;
    const showBeats = beatPx >= 22;
    const lines: {
      left: number;
      strength: "bar" | "beat";
      label: string | null;
      index: number;
    }[] = [];
    for (let i = 0; i <= totalBeats; i++) {
      const withinBar = i % beatsPerBar;
      const barNumber = Math.floor(i / beatsPerBar) + 1;
      const beatNumber = withinBar + 1;
      const strength: "bar" | "beat" = withinBar === 0 ? "bar" : "beat";
      const label =
        withinBar === 0 ? `${barNumber}` : showBeats ? `${barNumber}.${beatNumber}` : null;
      lines.push({ left: i * secondsPerBeat * pxPerSecond, strength, label, index: i });
    }
    return lines;
  }, [totalSeconds, secondsPerBeat, pxPerSecond, beatsPerBar]);

  const seekFromClientX = (clientX: number, rect: DOMRect) => {
    const seconds = Math.max(0, (clientX - rect.left) / pxPerSecond);
    onSeek(seconds);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    target.setPointerCapture(e.pointerId);
    seekFromClientX(e.clientX, rect);

    const onMove = (ev: PointerEvent) => seekFromClientX(ev.clientX, rect);
    const onUp = () => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  return (
    <div
      onPointerDown={handlePointerDown}
      title="Click or drag to move the playhead"
      className="relative cursor-pointer bg-surface"
      style={{ height: RULER_HEIGHT, width: totalSeconds * pxPerSecond }}
    >
      {marks.map((mark) => (
        <div
          key={mark.index}
          className={`pointer-events-none absolute top-0 h-full pl-1.5 pt-1.5 text-[10px] ${
            mark.strength === "bar" ? "border-l border-border/70 text-muted" : "text-muted/50"
          }`}
          style={{ left: mark.left }}
        >
          {mark.label}
        </div>
      ))}
    </div>
  );
}
