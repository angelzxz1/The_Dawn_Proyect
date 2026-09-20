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
  /** Grid size (seconds) a clip drag snaps to; 0 means free positioning. */
  snapSeconds: number;
  /** Whether this track is the clicked/focused one - tints the whole lane. */
  selected: boolean;
  /** Whether this track is record-armed - shows a small indicator dot. */
  armed: boolean;
  /** Which clips (by id) on this lane are selected - Delete/duplicate/drag
   * operate on all of them together. */
  selectedClipIds: Set<string>;
  onSelectTrack: () => void;
  /** `additive` is true for a Ctrl/Cmd-click. */
  onSelectClip: (clipId: string, additive: boolean) => void;
  onEditClip: (clipId: string) => void;
  onMoveClip: (clipId: string, offsetSeconds: number) => void;
  onResizeClip: (clipId: string, lengthSeconds: number) => void;
  onFadeChange: (clipId: string, fadeIn: number, fadeOut: number) => void;
  onGainChange: (clipId: string, gainDb: number) => void;
  onClipContextMenu: (clipId: string, e: React.MouseEvent) => void;
  onLaneContextMenu: (e: React.MouseEvent, atSeconds: number) => void;
  /** Fired once at the start of a clip move/resize/fade/gain drag - lets
   * the caller push one undo checkpoint per drag instead of one per pixel. */
  onClipDragStart: () => void;
}

export function TrackLane({
  clips,
  color,
  bpm,
  beatsPerBar,
  totalSeconds,
  pxPerSecond,
  snapSeconds,
  selected,
  armed,
  selectedClipIds,
  onSelectTrack,
  onSelectClip,
  onEditClip,
  onMoveClip,
  onResizeClip,
  onFadeChange,
  onGainChange,
  onClipContextMenu,
  onLaneContextMenu,
  onClipDragStart,
}: TrackLaneProps) {
  const marks = computeAdaptiveMarks(bpm, totalSeconds, pxPerSecond, beatsPerBar);

  return (
    <div
      onClick={onSelectTrack}
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
      {armed && (
        <div className="pointer-events-none absolute inset-0 z-0 border border-record/40" />
      )}
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
          durationSeconds={clip.kind === "audio" ? clip.durationSeconds : undefined}
          sourceOffset={clip.kind === "audio" ? clip.sourceOffset : undefined}
          fadeIn={clip.kind === "audio" ? clip.fadeIn : undefined}
          fadeOut={clip.kind === "audio" ? clip.fadeOut : undefined}
          gainDb={clip.kind === "audio" ? clip.gainDb : undefined}
          onFadeChange={(fadeIn, fadeOut) => onFadeChange(clip.id, fadeIn, fadeOut)}
          onGainChange={(gainDb) => onGainChange(clip.id, gainDb)}
          loop={!!clip.loopLength && clip.loopLength > 0 && clip.loopLength < clip.length}
          color={color}
          offset={clip.offset}
          length={clip.length}
          pxPerSecond={pxPerSecond}
          snapSeconds={snapSeconds}
          selected={selectedClipIds.has(clip.id)}
          onSelect={(additive) => onSelectClip(clip.id, additive)}
          onEdit={() => onEditClip(clip.id)}
          onMove={(offset) => onMoveClip(clip.id, offset)}
          onResize={(length) => onResizeClip(clip.id, length)}
          onContextMenu={(e) => onClipContextMenu(clip.id, e)}
          onDragStart={onClipDragStart}
        />
      ))}
    </div>
  );
}
