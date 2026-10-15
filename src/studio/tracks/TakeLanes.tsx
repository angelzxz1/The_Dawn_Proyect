"use client";

// A track's take lanes (takes.ts), under its own lane: each take's clips,
// darkened except where the comp - the track's lane - plays that take.
// Dragging across a take puts that part of it in the comp, on the grid;
// clicking one of its clips puts that whole clip in.

import { memo, useState } from "react";
import { Check, X } from "lucide-react";
import { ClipBlock } from "@/studio/timeline/ClipBlock";
import { TAKE_LANE_HEIGHT, TRACK_HEADER_WIDTH } from "@/studio/timeline/layout";
import type { TrackColor } from "@/project/colors";
import { trackColorFromHex } from "@/project/colors";
import type { TimeRange } from "@/project/timeRange";
import type { TakeLane } from "@/project/types";

const noop = () => {};

/** The parts of [0, total) that `used` doesn't cover. */
function unusedParts(used: TimeRange[], total: number): TimeRange[] {
  const sorted = [...used].sort((a, b) => a.start - b.start);
  const out: TimeRange[] = [];
  let at = 0;
  sorted.forEach((r) => {
    if (r.start > at) out.push({ start: at, end: r.start });
    at = Math.max(at, r.end);
  });
  if (at < total) out.push({ start: at, end: total });
  return out;
}

interface TakeLaneRowProps {
  lane: TakeLane;
  /** Where the track plays this take (takes.ts compSpans). */
  used: TimeRange[];
  color: TrackColor;
  pxPerSecond: number;
  totalSeconds: number;
  /** The grid a drag snaps to (s); 0 for none. */
  snapSeconds: number;
  /** Puts what the take has between the range's ends in the comp. */
  onComp: (laneId: string, range: TimeRange) => void;
}

export const TakeLaneRow = memo(function TakeLaneRow({ lane, used, color, pxPerSecond, totalSeconds, snapSeconds, onComp }: TakeLaneRowProps) {
  const [dragging, setDragging] = useState<TimeRange | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const row = e.currentTarget;
    row.setPointerCapture(e.pointerId);
    const left = row.getBoundingClientRect().left;
    const at = (x: number) => Math.max(0, (x - left) / pxPerSecond);
    const snap = (t: number) => (snapSeconds > 0 ? Math.round(t / snapSeconds) * snapSeconds : t);
    const anchor = at(e.clientX);
    let moved = false;
    let range: TimeRange | null = null;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - e.clientX) <= 3) return;
      moved = true;
      const start = snap(Math.min(anchor, at(ev.clientX)));
      const end = snap(Math.max(anchor, at(ev.clientX)));
      range = end - start > 1e-6 ? { start, end } : null;
      setDragging(range);
    };
    const onUp = () => {
      row.releasePointerCapture(e.pointerId);
      row.removeEventListener("pointermove", onMove);
      row.removeEventListener("pointerup", onUp);
      setDragging(null);
      if (moved) {
        if (range) onComp(lane.id, range);
        return;
      }
      // A click on one of the take's clips: all of it.
      const clip = lane.clips.find((c) => anchor >= c.offset && anchor < c.offset + c.length);
      if (clip) onComp(lane.id, { start: clip.offset, end: clip.offset + clip.length });
    };
    row.addEventListener("pointermove", onMove);
    row.addEventListener("pointerup", onUp);
  };

  return (
    <div
      role="group"
      aria-label={`${lane.name} lane`}
      data-take-lane={lane.id}
      onPointerDown={handlePointerDown}
      title="Drag across the take to put that part of it in the track; click one of its clips to put all of it in"
      className="relative cursor-pointer select-none border-b border-border bg-background/40"
      style={{ height: TAKE_LANE_HEIGHT, width: totalSeconds * pxPerSecond }}
    >
      {lane.clips.map((clip) => (
        <ClipBlock
          key={clip.id}
          passive
          clipId={clip.id}
          clipType={clip.kind}
          notes={clip.kind === "midi" ? clip.notes : []}
          audioPeaks={clip.kind === "audio" ? clip.peaks : undefined}
          audioFileName={clip.kind === "audio" ? clip.fileName : undefined}
          audioUrl={clip.kind === "audio" ? clip.url : undefined}
          durationSeconds={clip.kind === "audio" ? clip.durationSeconds : undefined}
          sourceOffset={clip.kind === "audio" ? clip.sourceOffset : undefined}
          gainDb={clip.kind === "audio" ? clip.gainDb : undefined}
          name={lane.name}
          color={clip.color ? trackColorFromHex(clip.color) : color}
          offset={clip.offset}
          length={clip.length}
          pxPerSecond={pxPerSecond}
          selected={false}
          rowHeight={TAKE_LANE_HEIGHT}
          onSelect={noop}
          onEdit={noop}
          onMove={noop}
          onResize={noop}
          onContextMenu={noop}
        />
      ))}
      {/* What the comp doesn't take from here, darker. */}
      {unusedParts(used, totalSeconds).map((r) => (
        <div
          key={`off-${r.start}`}
          className="pointer-events-none absolute inset-y-0 bg-black/45"
          style={{ left: r.start * pxPerSecond, width: (r.end - r.start) * pxPerSecond }}
        />
      ))}
      {used.map((r) => (
        <div
          key={`on-${r.start}`}
          data-comp-part
          className="pointer-events-none absolute top-0 h-[3px]"
          style={{ left: r.start * pxPerSecond, width: (r.end - r.start) * pxPerSecond, background: color.accent }}
        />
      ))}
      {dragging && (
        <div
          className="pointer-events-none absolute inset-y-0 z-[15] border-x border-white/70 bg-white/15"
          style={{ left: dragging.start * pxPerSecond, width: (dragging.end - dragging.start) * pxPerSecond }}
        />
      )}
    </div>
  );
});

/** A take lane's header, beside it: its name, and to use or delete it. */
export function TakeLaneHeader({
  lane,
  inUse,
  onUse,
  onDelete,
}: {
  lane: TakeLane;
  /** The comp plays some of it. */
  inUse: boolean;
  onUse: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="group"
      aria-label={`${lane.name} header`}
      className="flex shrink-0 items-center gap-1.5 border-b border-r border-border bg-surface pl-6 pr-2 text-[11px]"
      style={{ width: TRACK_HEADER_WIDTH, height: TAKE_LANE_HEIGHT }}
    >
      <span className={`truncate ${inUse ? "text-foreground" : "text-muted"}`}>{lane.name}</span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onUse}
        title="Use all of this take: the track plays it wherever it has something"
        aria-label={`Use all of ${lane.name}`}
        className="flex h-5 items-center gap-1 rounded border border-border px-1.5 text-muted hover:bg-surface-raised hover:text-foreground"
      >
        <Check size={11} /> Use
      </button>
      <button
        type="button"
        onClick={onDelete}
        title="Delete this take (what the track plays from it stays)"
        aria-label={`Delete ${lane.name}`}
        className="flex h-5 w-5 items-center justify-center rounded border border-border text-muted hover:bg-surface-raised hover:text-record"
      >
        <X size={11} />
      </button>
    </div>
  );
}
