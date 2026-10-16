"use client";

import { useMemo } from "react";
import { RULER_HEIGHT, computeAdaptiveMarks, snapUnitFor } from "./layout";
import { makeGrid, type TempoMap } from "@/project/tempoMap";

interface TimelineRulerProps {
  /** Where the beats and bars are. */
  tempo: TempoMap;
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
  tempo,
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
    () => computeAdaptiveMarks(tempo, totalSeconds, pxPerSecond, beatsPerBar),
    [tempo, totalSeconds, pxPerSecond, beatsPerBar]
  );
  /** The finest grid drawn: what clicks and drags here snap to. */
  const grid = useMemo(() => makeGrid(tempo, snapUnitFor(tempo, pxPerSecond, beatsPerBar)), [tempo, pxPerSecond, beatsPerBar]);
  const snappedAt = (clientX: number, rect: DOMRect) => Math.max(0, grid.snap(Math.max(0, (clientX - rect.left) / pxPerSecond)));

  const seekFromClientX = (clientX: number, rect: DOMRect) => onSeek(snappedAt(clientX, rect));

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    target.setPointerCapture(e.pointerId);

    if (e.shiftKey) {
      const anchor = snappedAt(e.clientX, rect);
      const step = grid.stepAt(anchor);
      onSetLoopRegion(anchor, anchor + step);
      const onMove = (ev: PointerEvent) => {
        const cur = snappedAt(ev.clientX, rect);
        onSetLoopRegion(Math.min(anchor, cur), Math.max(anchor, cur, anchor + step));
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
