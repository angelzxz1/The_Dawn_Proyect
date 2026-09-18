"use client";

import { ClipBlock } from "./ClipBlock";
import type { NoteEvent } from "@/lib/types";
import type { TrackColor } from "@/lib/colors";
import { computeBarMarks, TRACK_ROW_HEIGHT } from "@/lib/timeline";

interface TrackLaneProps {
  notes: NoteEvent[];
  color: TrackColor;
  bpm: number;
  totalSeconds: number;
  pxPerSecond: number;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
}

export function TrackLane({
  notes,
  color,
  bpm,
  totalSeconds,
  pxPerSecond,
  selected,
  onSelect,
  onEdit,
}: TrackLaneProps) {
  const marks = computeBarMarks(bpm, totalSeconds, pxPerSecond);

  return (
    <div
      onClick={onSelect}
      className={`relative cursor-pointer border-b border-border ${
        selected ? "bg-surface-raised/40" : ""
      }`}
      style={{ height: TRACK_ROW_HEIGHT, width: totalSeconds * pxPerSecond }}
    >
      {marks.map((mark) => (
        <div
          key={mark.index}
          className="absolute top-0 h-full border-l border-border/40"
          style={{ left: mark.left }}
        />
      ))}
      <ClipBlock
        notes={notes}
        color={color}
        pxPerSecond={pxPerSecond}
        selected={selected}
        onSelect={onSelect}
        onEdit={onEdit}
      />
    </div>
  );
}
