"use client";

import { ClipBlock } from "./ClipBlock";
import type { ClipInstance } from "@/lib/types";
import type { TrackColor } from "@/lib/colors";
import { computeAdaptiveMarks, TRACK_ROW_HEIGHT } from "@/lib/timeline";

interface TrackLaneProps {
  clips: ClipInstance[];
  color: TrackColor;
  bpm: number;
  beatsPerBar: number;
  totalSeconds: number;
  pxPerSecond: number;
  /** Whether this track is armed/selected - highlights every clip on it. */
  selected: boolean;
  onSelect: () => void;
  onEditClip: (clipId: string) => void;
  onMoveClip: (clipId: string, offsetSeconds: number) => void;
  onResizeClip: (clipId: string, lengthSeconds: number) => void;
  onClipContextMenu: (clipId: string, e: React.MouseEvent) => void;
  onLaneContextMenu: (e: React.MouseEvent, atSeconds: number) => void;
}

export function TrackLane({
  clips,
  color,
  bpm,
  beatsPerBar,
  totalSeconds,
  pxPerSecond,
  selected,
  onSelect,
  onEditClip,
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
      {clips.map((clip) => (
        <ClipBlock
          key={clip.id}
          clipType={clip.kind}
          notes={clip.kind === "midi" ? clip.notes : []}
          audioPeaks={clip.kind === "audio" ? clip.peaks : undefined}
          audioFileName={clip.kind === "audio" ? clip.fileName : undefined}
          color={color}
          offset={clip.offset}
          length={clip.length}
          bpm={bpm}
          beatsPerBar={beatsPerBar}
          pxPerSecond={pxPerSecond}
          selected={selected}
          onSelect={onSelect}
          onEdit={() => onEditClip(clip.id)}
          onMove={(offset) => onMoveClip(clip.id, offset)}
          onResize={(length) => onResizeClip(clip.id, length)}
          onContextMenu={(e) => onClipContextMenu(clip.id, e)}
        />
      ))}
    </div>
  );
}
