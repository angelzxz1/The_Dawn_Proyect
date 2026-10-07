"use client";

import { useMemo } from "react";
import { RULER_HEIGHT, computeAdaptiveMarks, snapUnitFor } from "@/lib/timeline";

interface TimelineRulerProps {
  bpm: number;
  totalSeconds: number;
  pxPerSecond: number;
  beatsPerBar: number;
  onSeek: (seconds: number) => void;
  loopStart: number;
  loopEnd: number;
  /** Shift-drag on the ruler sets a new loop region and turns looping on. */
  onSetLoopRegion: (start: number, end: number) => void;
}

export function TimelineRuler({
  bpm,
  totalSeconds,
  pxPerSecond,
  beatsPerBar,
  onSeek,
  loopStart,
  loopEnd,
  onSetLoopRegion,
}: TimelineRulerProps) {
  // Adaptive grid: bars always shown; beat and then 16th-note subdivisions
  // (with their labels) fade in as you zoom in, the same progression as the
  // piano roll editor's ruler - "1", then "1.2", then "1.2.3".
  const marks = useMemo(
    () => computeAdaptiveMarks(bpm, totalSeconds, pxPerSecond, beatsPerBar),
    [bpm, totalSeconds, pxPerSecond, beatsPerBar]
  );

  const seekFromClientX = (clientX: number, rect: DOMRect) => {
    const raw = Math.max(0, (clientX - rect.left) / pxPerSecond);
    const unit = snapUnitFor(bpm, pxPerSecond, beatsPerBar);
    onSeek(Math.max(0, Math.round(raw / unit) * unit));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    target.setPointerCapture(e.pointerId);

    if (e.shiftKey) {
      const unit = snapUnitFor(bpm, pxPerSecond, beatsPerBar);
      const anchor = Math.max(0, Math.round((e.clientX - rect.left) / pxPerSecond / unit) * unit);
      onSetLoopRegion(anchor, anchor + unit);
      const onMove = (ev: PointerEvent) => {
        const cur = Math.max(0, Math.round((ev.clientX - rect.left) / pxPerSecond / unit) * unit);
        onSetLoopRegion(Math.min(anchor, cur), Math.max(anchor, cur, anchor + unit));
      };
      const onUp = () => {
        target.releasePointerCapture(e.pointerId);
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      return;
    }

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
      title="Click or drag to move the playhead (snaps to the grid) · shift-drag to set the loop region"
      className="relative cursor-pointer bg-surface"
      style={{ height: RULER_HEIGHT, width: totalSeconds * pxPerSecond }}
    >
      {loopEnd > loopStart && (
        <div
          className="pointer-events-none absolute top-0 h-full border-x border-accent/60 bg-accent/20"
          style={{ left: loopStart * pxPerSecond, width: (loopEnd - loopStart) * pxPerSecond }}
        />
      )}
      {marks.map((mark) => (
        <div
          key={mark.index}
          className="pointer-events-none absolute top-0 h-full"
          style={{
            left: mark.left,
            borderLeft: `1px solid ${
              mark.strength === "bar"
                ? "rgba(230,230,235,0.4)"
                : mark.strength === "beat"
                  ? "rgba(230,230,235,0.2)"
                  : "rgba(230,230,235,0.09)"
            }`,
          }}
        >
          {mark.label && (
            <span
              className={`pl-1.5 pt-1.5 text-[10px] ${
                mark.strength === "bar" ? "text-muted" : "text-muted/50"
              }`}
            >
              {mark.label}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
