"use client";

import { ClipBlock } from "./ClipBlock";
import type { ClipType, NoteEvent } from "@/lib/types";
import type { TrackColor } from "@/lib/colors";
import { computeAdaptiveMarks, TRACK_ROW_HEIGHT } from "@/lib/timeline";

interface TrackLaneProps {
  clipType?: ClipType;
  notes: NoteEvent[];
  audioPeaks?: number[];
  audioFileName?: string;
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
  onClipContextMenu: (e: React.MouseEvent) => void;
  onLaneContextMenu: (e: React.MouseEvent, atSeconds: number) => void;
}

export function TrackLane({
  clipType = "midi",
  notes,
  audioPeaks,
  audioFileName,
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
  onClipContextMenu,
  onLaneContextMenu,
}: TrackLaneProps) {
  const marks = computeAdaptiveMarks(bpm, totalSeconds, pxPerSecond, beatsPerBar);

  return (
    <div
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        onLaneContextMenu(e, Math.max(0, (e.clientX - rect.left) / pxPerSecond));
      }}
      className={`relative cursor-pointer border-b border-border ${
        selected ? "bg-surface-raised/40" : ""
      }`}
      style={{ height: TRACK_ROW_HEIGHT, width: totalSeconds * pxPerSecond }}
    >
      {marks.map((mark) => (
        <div
          key={mark.index}
          className="pointer-events-none absolute top-0 h-full"
          style={{
            left: mark.left,
            borderLeft: `1px solid ${
              mark.strength === "bar"
                ? "rgba(230,230,235,0.22)"
                : mark.strength === "beat"
                  ? "rgba(230,230,235,0.1)"
                  : "rgba(230,230,235,0.045)"
            }`,
          }}
        />
      ))}
      <ClipBlock
        clipType={clipType}
        notes={notes}
        audioPeaks={audioPeaks}
        audioFileName={audioFileName}
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
        onContextMenu={onClipContextMenu}
      />
    </div>
  );
}
