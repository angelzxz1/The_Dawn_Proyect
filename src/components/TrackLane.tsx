"use client";

import { ClipBlock } from "./ClipBlock";
import type { NoteEvent } from "@/lib/types";
import type { TrackColor } from "@/lib/colors";
import { computeBarMarks, TRACK_ROW_HEIGHT } from "@/lib/timeline";

interface TrackLaneProps {
  notes: NoteEvent[];
  color: TrackColor;
  offset: number;
  length: number;
  bpm: number;
  beatsPerBar: number;
  totalSeconds: number;
  pxPerSecond: number;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onMoveClip: (offsetSeconds: number) => void;
  onResizeClip: (lengthSeconds: number) => void;
}

export function TrackLane({
  notes,
  color,
  offset,
  length,
  bpm,
  beatsPerBar,
  totalSeconds,
  pxPerSecond,
  selected,
  onSelect,
  onEdit,
  onMoveClip,
  onResizeClip,
}: TrackLaneProps) {
  const marks = computeBarMarks(bpm, totalSeconds, pxPerSecond, beatsPerBar);

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
        offset={offset}
        length={length}
        bpm={bpm}
        beatsPerBar={beatsPerBar}
        pxPerSecond={pxPerSecond}
        selected={selected}
        onSelect={onSelect}
        onEdit={onEdit}
        onMove={onMoveClip}
        onResize={onResizeClip}
      />
    </div>
  );
}
