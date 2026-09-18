"use client";

import { computeBarMarks, RULER_HEIGHT } from "@/lib/timeline";

interface TimelineRulerProps {
  bpm: number;
  totalSeconds: number;
  pxPerSecond: number;
}

export function TimelineRuler({ bpm, totalSeconds, pxPerSecond }: TimelineRulerProps) {
  const marks = computeBarMarks(bpm, totalSeconds, pxPerSecond);

  return (
    <div
      className="sticky top-0 z-10 border-b border-border bg-surface"
      style={{ height: RULER_HEIGHT, width: totalSeconds * pxPerSecond }}
    >
      {marks.map((mark) => (
        <div
          key={mark.index}
          className="absolute top-0 h-full border-l border-border/70 pl-1.5 pt-1.5 text-[10px] text-muted"
          style={{ left: mark.left }}
        >
          {mark.index + 1}
        </div>
      ))}
    </div>
  );
}
