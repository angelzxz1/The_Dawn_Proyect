"use client";

import { memo, useState } from "react";
import { ClipBlock, type SlipChange } from "@/studio/timeline/ClipBlock";
import { RecordingClip } from "@/studio/timeline/RecordingClip";
import { TOOL_CURSORS, type ClipTool } from "@/studio/timeline/clipTools";
import type { ClipInstance } from "@/project/types";
import type { TimeRange } from "@/project/timeRange";
import { beatAtSeconds, secondsAtBeat, type Grid, type TempoMap } from "@/project/tempoMap";
import { trackColorFromHex, type TrackColor } from "@/project/colors";
import { computeAdaptiveMarks, TRACK_ROW_HEIGHT } from "@/studio/timeline/layout";
import { GROOVE_DRAG_MIME } from "@/library/grooves";

/** What a lane can do, given the track's id. The studio passes the same
 * object to every lane, and the same one on every redraw (see
 * useStableActions), so a lane redraws only when its own track does. */
export interface TrackLaneActions {
  selectTrack(channelId: string): void;
  /** `additive` is true for a Ctrl/Cmd-click. */
  selectClip(channelId: string, clipId: string, additive: boolean): void;
  editClip(channelId: string, clipId: string): void;
  moveClip(channelId: string, clipId: string, offsetSeconds: number): void;
  resizeClip(channelId: string, clipId: string, lengthSeconds: number): void;
  setFades(channelId: string, clipId: string, fadeIn: number, fadeOut: number): void;
  setGain(channelId: string, clipId: string, gainDb: number): void;
  clipContextMenu(channelId: string, clipId: string, e: React.MouseEvent): void;
  laneContextMenu(channelId: string, e: React.MouseEvent, atSeconds: number): void;
  /** Fired once at the start of a clip move/resize/fade/gain drag - lets
   * the caller push one undo checkpoint per drag instead of one per pixel. */
  clipDragStart(): void;
  /** A file dropped from the OS - `atSeconds` is where on the timeline it
   * was dropped, unsnapped (the caller snaps it to the bar). */
  dropAudioFile(channelId: string, file: File, atSeconds: number): void;
  /** A groove dragged from the browser was dropped here. */
  dropGroove(channelId: string, grooveId: string, atSeconds: number): void;
  /** Split tool: cut a clip at `seconds` on the timeline. */
  splitClip(channelId: string, clipId: string, seconds: number): void;
  /** Draw tool: a new, empty MIDI clip. */
  drawClip(channelId: string, offset: number, length: number): void;
  /** Erase tool: the pointer went down on a clip (or empty lane); the clips
   * the drag passes over go when it ends. */
  startErase(clipId: string | null): void;
  /** Slip tool: a clip's content, slid. */
  slipClip(channelId: string, clipId: string, change: SlipChange): void;
  /** Pointer tool: the pointer went down on empty lane space. A drag from
   * there selects time, on the lanes it crosses; a click clears it. */
  startTimeSelection(clientX: number, clientY: number): void;
  /** A clip's name typed in, or null when renaming was let go of (Esc). */
  renameClip(channelId: string, clipId: string, name: string | null): void;
}

interface TrackLaneProps {
  clips: ClipInstance[];
  color: TrackColor;
  /** Where the beats and bars are (tempoMap.ts). */
  tempo: TempoMap;
  beatsPerBar: number;
  totalSeconds: number;
  pxPerSecond: number;
  /** The grid clip drags and drawing snap to. */
  grid: Grid;
  /** Whether this track is the clicked/focused one - tints the whole lane. */
  selected: boolean;
  /** Whether this track is record-armed - shows a small indicator dot. */
  armed: boolean;
  /** Recording onto this track right now: the take is drawn as it comes in. */
  recording?: boolean;
  /** The engine id of this track (for reading the recording in progress). */
  channelId: string;
  /** The track's name, which labels the lane. */
  name: string;
  /** Which clips (by id) on this lane are selected - Delete/duplicate/drag
   * operate on all of them together. */
  selectedClipIds: Set<string>;
  actions: TrackLaneActions;
  /** Whether this track can accept an audio file dragged in from the OS -
   * only an audio-type channel can. A MIDI lane still swallows the drop
   * (so the browser doesn't navigate to the file) but shows no affordance
   * and doesn't import anything. */
  acceptsFileDrop: boolean;
  /** Whether a groove dragged from the browser can be dropped here (MIDI
   * tracks only). */
  acceptsGrooves: boolean;
  /** What to do here, shown while the lane is empty. */
  hint?: string;
  /** The lane's height (shorter when the track is folded). */
  rowHeight?: number;
  /** A group's lane: its members' clips drawn faintly, one stripe per
   * member, instead of clips of its own. */
  overview?: { id: string; clips: ClipInstance[]; color: TrackColor }[];
  /** The arrangement's edit tool (clipTools.ts). */
  tool?: ClipTool;
  /** Whether the draw tool can make a clip here (MIDI tracks). */
  canDraw?: boolean;
  /** Erase tool: the clips a drag has passed over, on any lane. */
  erasingIds?: ReadonlySet<string>;
  /** The time selection, when it's on this lane. */
  timeSelection?: TimeRange;
  /** The clip on this lane being renamed. */
  renamingClipId?: string;
}

const NO_CLIPS: ReadonlySet<string> = new Set();
/** The shortest clip the draw tool makes with the grid off (s). */
const MIN_DRAWN = 0.25;

/** One track's lane of clips. Memoized: it redraws only when its own props
 * change. */
export const TrackLane = memo(function TrackLane({
  clips,
  color,
  tempo,
  beatsPerBar,
  totalSeconds,
  pxPerSecond,
  grid,
  selected,
  armed,
  recording = false,
  channelId,
  name,
  selectedClipIds,
  actions,
  acceptsFileDrop,
  acceptsGrooves,
  hint,
  rowHeight = TRACK_ROW_HEIGHT,
  overview,
  tool = "pointer",
  canDraw = false,
  erasingIds = NO_CLIPS,
  timeSelection,
  renamingClipId,
}: TrackLaneProps) {
  const onSelectTrack = () => actions.selectTrack(channelId);
  const onSelectClip = (clipId: string, additive: boolean) => actions.selectClip(channelId, clipId, additive);
  const onEditClip = (clipId: string) => actions.editClip(channelId, clipId);
  const onMoveClip = (clipId: string, offset: number) => actions.moveClip(channelId, clipId, offset);
  const onResizeClip = (clipId: string, length: number) => actions.resizeClip(channelId, clipId, length);
  const onFadeChange = (clipId: string, fadeIn: number, fadeOut: number) => actions.setFades(channelId, clipId, fadeIn, fadeOut);
  const onGainChange = (clipId: string, gainDb: number) => actions.setGain(channelId, clipId, gainDb);
  const onClipContextMenu = (clipId: string, e: React.MouseEvent) => actions.clipContextMenu(channelId, clipId, e);
  const onLaneContextMenu = (e: React.MouseEvent, atSeconds: number) => actions.laneContextMenu(channelId, e, atSeconds);
  const onClipDragStart = actions.clipDragStart;
  const onDropAudioFile = (file: File, atSeconds: number) => actions.dropAudioFile(channelId, file, atSeconds);
  const onDropGroove = acceptsGrooves ? (grooveId: string, atSeconds: number) => actions.dropGroove(channelId, grooveId, atSeconds) : undefined;
  const marks = computeAdaptiveMarks(tempo, totalSeconds, pxPerSecond, beatsPerBar);
  const [fileDragOver, setFileDragOver] = useState(false);
  const [grooveDragOver, setGrooveDragOver] = useState(false);
  const isGroove = (e: React.DragEvent) => !!onDropGroove && e.dataTransfer.types.includes(GROOVE_DRAG_MIME);

  const atSecondsFromEvent = (e: React.DragEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, (e.clientX - rect.left) / pxPerSecond);
  };

  /** Draw tool: the clip being drawn (s on the timeline). */
  const [drawing, setDrawing] = useState<{ start: number; end: number } | null>(null);
  const drawsHere = tool === "draw" && canDraw;

  /** Draw tool: from where the pointer goes down to where it comes up,
   * snapped outward to the grid; a click makes a one-bar clip. Erase tool:
   * a drag from empty space deletes the clips it crosses. Pointer tool: it
   * selects time. */
  const handleLanePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (tool === "erase") return actions.startErase(null);
    if (tool === "pointer") return actions.startTimeSelection(e.clientX, e.clientY);
    if (!drawsHere) return;
    const lane = e.currentTarget;
    lane.setPointerCapture(e.pointerId);
    const left = lane.getBoundingClientRect().left;
    const at = (clientX: number) => Math.max(0, (clientX - left) / pxPerSecond);
    const anchor = at(e.clientX);
    const span = (x: number) => {
      const start = Math.max(0, grid.floor(Math.min(anchor, x)));
      const end = grid.ceil(Math.max(anchor, x));
      return { start, end: Math.max(end, start + (grid.stepAt(start) || MIN_DRAWN)) };
    };
    // A click: one bar, from the grid line before it.
    const barStart = Math.max(0, grid.floor(anchor));
    const firstBar = { start: barStart, end: secondsAtBeat(tempo, beatAtSeconds(tempo, barStart) + beatsPerBar) };
    let dragged = false;
    let current = firstBar;
    setDrawing(current);
    const onMove = (ev: PointerEvent) => {
      if (!dragged && Math.abs(ev.clientX - e.clientX) <= 3) return;
      dragged = true;
      current = span(at(ev.clientX));
      setDrawing(current);
    };
    const onUp = () => {
      lane.releasePointerCapture(e.pointerId);
      lane.removeEventListener("pointermove", onMove);
      lane.removeEventListener("pointerup", onUp);
      setDrawing(null);
      actions.drawClip(channelId, current.start, current.end - current.start);
    };
    lane.addEventListener("pointermove", onMove);
    lane.addEventListener("pointerup", onUp);
  };

  return (
    <div
      role="group"
      aria-label={`${name} lane`}
      data-channel-id={channelId}
      onPointerDown={handleLanePointerDown}
      // Drawing and erasing aren't a click on the lane (which would select
      // the track, and so drop the clip just drawn from the selection).
      onClick={drawsHere || tool === "erase" ? undefined : onSelectTrack}
      onContextMenu={(e) => {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        onLaneContextMenu(e, Math.max(0, (e.clientX - rect.left) / pxPerSecond));
      }}
      onDragEnter={(e) => {
        if (isGroove(e)) {
          e.preventDefault();
          setGrooveDragOver(true);
          return;
        }
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        if (acceptsFileDrop) setFileDragOver(true);
      }}
      onDragOver={(e) => {
        if (isGroove(e)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          return;
        }
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = acceptsFileDrop ? "copy" : "none";
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setFileDragOver(false);
        setGrooveDragOver(false);
      }}
      onDrop={(e) => {
        if (isGroove(e)) {
          e.preventDefault();
          setGrooveDragOver(false);
          const id = e.dataTransfer.getData(GROOVE_DRAG_MIME);
          if (id) onDropGroove?.(id, atSecondsFromEvent(e));
          return;
        }
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setFileDragOver(false);
        if (!acceptsFileDrop) return;
        const file = e.dataTransfer.files[0];
        if (file) onDropAudioFile(file, atSecondsFromEvent(e));
      }}
      className={`relative cursor-pointer select-none border-b border-border ${
        selected ? "bg-surface-raised/40" : ""
      } ${fileDragOver || grooveDragOver ? "bg-accent/10 ring-1 ring-inset ring-accent" : ""}`}
      style={{
        height: rowHeight,
        width: totalSeconds * pxPerSecond,
        cursor: drawsHere ? TOOL_CURSORS.draw : tool === "erase" ? TOOL_CURSORS.erase : undefined,
      }}
    >
      {drawing && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border-2 border-dashed"
          style={{
            left: drawing.start * pxPerSecond,
            width: (drawing.end - drawing.start) * pxPerSecond,
            top: rowHeight < 60 ? 3 : 10,
            bottom: rowHeight < 60 ? 3 : 10,
            borderColor: color.accent,
            background: color.accentSoft,
          }}
        />
      )}
      {armed && (
        <div className="pointer-events-none absolute inset-0 z-0 border border-record/40" />
      )}
      {grooveDragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-xs font-medium text-accent">
          Drop the groove here
        </div>
      )}
      {fileDragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-xs font-medium text-accent">
          Drop audio file here
        </div>
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
      {overview && <GroupOverview members={overview} rowHeight={rowHeight} pxPerSecond={pxPerSecond} />}
      {hint && clips.length === 0 && !overview?.some((m) => m.clips.length > 0) && !recording && !fileDragOver && !grooveDragOver && (
        <div className="pointer-events-none absolute inset-y-0 left-3 z-0 flex items-center text-[11.5px] text-muted/80">{hint}</div>
      )}
      {recording && <RecordingClip channelId={channelId} pxPerSecond={pxPerSecond} rowHeight={rowHeight} />}
      {clips.map((clip) => (
        <ClipBlock
          key={clip.id}
          clipType={clip.kind}
          notes={clip.kind === "midi" ? clip.notes : []}
          audioPeaks={clip.kind === "audio" ? clip.peaks : undefined}
          audioFileName={clip.kind === "audio" ? clip.fileName : undefined}
          audioUrl={clip.kind === "audio" ? clip.url : undefined}
          loopLength={clip.loopLength}
          durationSeconds={clip.kind === "audio" ? clip.durationSeconds : undefined}
          sourceOffset={clip.kind === "audio" ? clip.sourceOffset : undefined}
          fadeIn={clip.kind === "audio" ? clip.fadeIn : undefined}
          fadeOut={clip.kind === "audio" ? clip.fadeOut : undefined}
          gainDb={clip.kind === "audio" ? clip.gainDb : undefined}
          onFadeChange={(fadeIn, fadeOut) => onFadeChange(clip.id, fadeIn, fadeOut)}
          onGainChange={(gainDb) => onGainChange(clip.id, gainDb)}
          loop={!!clip.loopLength && clip.loopLength > 0 && clip.loopLength < clip.length}
          color={clip.color ? trackColorFromHex(clip.color) : color}
          name={clip.name}
          renaming={clip.id === renamingClipId}
          onRename={(value) => actions.renameClip(channelId, clip.id, value)}
          offset={clip.offset}
          length={clip.length}
          pxPerSecond={pxPerSecond}
          grid={grid}
          selected={selectedClipIds.has(clip.id)}
          onSelect={(additive) => onSelectClip(clip.id, additive)}
          onEdit={() => onEditClip(clip.id)}
          onMove={(offset) => onMoveClip(clip.id, offset)}
          onResize={(length) => onResizeClip(clip.id, length)}
          onContextMenu={(e) => onClipContextMenu(clip.id, e)}
          onDragStart={onClipDragStart}
          rowHeight={rowHeight}
          clipId={clip.id}
          tool={tool}
          onSplitAt={(seconds) => actions.splitClip(channelId, clip.id, seconds)}
          onEraseStart={() => actions.startErase(clip.id)}
          onSlip={(change) => actions.slipClip(channelId, clip.id, change)}
          erasing={erasingIds.has(clip.id)}
        />
      ))}
      {timeSelection && (
        // Over the clips (and their handles), under the sticky ruler.
        <div
          data-time-selection
          className="pointer-events-none absolute inset-y-0 z-[15] border-x border-accent bg-accent/20"
          style={{ left: timeSelection.start * pxPerSecond, width: (timeSelection.end - timeSelection.start) * pxPerSecond }}
        />
      )}
    </div>
  );
});

/** A group lane's summary: each member's clips as a faint bar in its own
 * stripe, like Ableton's group track. */
function GroupOverview({
  members,
  rowHeight,
  pxPerSecond,
}: {
  members: { id: string; clips: ClipInstance[]; color: TrackColor }[];
  rowHeight: number;
  pxPerSecond: number;
}) {
  const pad = rowHeight < 60 ? 4 : 10;
  const stripe = members.length ? (rowHeight - pad * 2) / members.length : 0;
  return (
    <div className="pointer-events-none absolute inset-0">
      {members.map((m, i) =>
        m.clips.map((clip) => (
          <div
            key={`${m.id}:${clip.id}`}
            className="absolute rounded-sm"
            style={{
              left: clip.offset * pxPerSecond,
              width: Math.max(2, clip.length * pxPerSecond),
              top: pad + i * stripe + (stripe > 4 ? 1 : 0),
              height: Math.max(1, stripe - (stripe > 4 ? 2 : 0)),
              background: clip.color ?? m.color.accent,
              opacity: 0.45,
            }}
          />
        ))
      )}
    </div>
  );
}
