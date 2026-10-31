"use client";

import { useMemo, useRef, useState } from "react";
import { Repeat } from "lucide-react";
import type { ClipType, NoteEvent } from "@/project/types";
import type { TrackColor } from "@/project/colors";
import { TRACK_ROW_HEIGHT } from "./layout";
import { WaveformCanvas, useWaveform } from "./WaveformCanvas";
import { TOOL_CURSORS, type ClipTool } from "./clipTools";
import { MAX_CLIP_NAME } from "@/project/clipEdits";
import { formatBpm, NO_GRID, type Grid } from "@/project/tempoMap";
import { EDGE_SNAP_PX, snapEdges, snapEnd, snapMove, type ClipSpan } from "./clipSnap";
import type { WarpView } from "@/project/warp";

/** What the slip tool changes: where an audio clip's content starts in its
 * file, or a MIDI clip's notes. */
export type SlipChange = { sourceOffset: number } | { notes: NoteEvent[] };

interface ClipBlockProps {
  clipType?: ClipType;
  notes: NoteEvent[];
  /** Waveform peaks (0..1) covering the FULL source file, and the source
   * file's name - only the [sourceOffset, sourceOffset + length) slice is
   * drawn, so a clip split off from another still shows the right piece
   * of the waveform. */
  audioPeaks?: number[];
  audioFileName?: string;
  /** The audio source, for drawing its full-resolution waveform. */
  audioUrl?: string;
  /** When set, the audio region repeats every this many seconds. */
  loopLength?: number | null;
  /** Full duration of the audio clip's source file, in seconds. */
  durationSeconds?: number;
  /** Where within the source buffer this clip's content starts, in
   * seconds. */
  sourceOffset?: number;
  fadeIn?: number;
  fadeOut?: number;
  /** This clip's own gain, in dB, independent of the channel fader. */
  gainDb?: number;
  onFadeChange?: (fadeIn: number, fadeOut: number) => void;
  onGainChange?: (gainDb: number) => void;
  /** Whether this clip's content repeats to fill its box - shown as a
   * small repeat badge. */
  loop?: boolean;
  color: TrackColor;
  offset: number;
  length: number;
  pxPerSecond: number;
  /** The grid drags snap to (tempoMap.ts); none means free - drag
   * position follows the pointer exactly. Alt drags free of it. */
  grid?: Grid;
  /** Every clip on every lane: with the grid on, a moved or resized
   * clip's edges snap to theirs when they come close (clipSnap.ts). */
  snapSpans?: readonly ClipSpan[];
  /** The selected clips (by id): dragging a selected one moves them all,
   * so their edges aren't snapped to. */
  selection?: ReadonlySet<string>;
  selected: boolean;
  /** `additive` is true for a Ctrl/Cmd-click, which should toggle this
   * clip's membership in the current selection instead of replacing it. */
  onSelect: (additive: boolean) => void;
  onEdit: () => void;
  onMove: (offsetSeconds: number) => void;
  onResize: (lengthSeconds: number) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  /** Fired once, right before the first actual move/resize/fade/gain drag
   * of a gesture - never for a click that just selects or edits the clip -
   * so a caller can push one undo checkpoint per drag instead of one per
   * pixel. */
  onDragStart?: () => void;
  /** The lane's height; a short (folded) lane shows just the clip's bar. */
  rowHeight?: number;
  /** The clip's id, on its element: an erase drag finds the clips it
   * passes over by it. */
  clipId?: string;
  /** The arrangement's edit tool (clipTools.ts). */
  tool?: ClipTool;
  /** Split tool: cut the clip at this time on the timeline (snapped). */
  onSplitAt?: (seconds: number) => void;
  /** Erase tool: the pointer went down on the clip. */
  onEraseStart?: () => void;
  /** Slip tool: what's inside the clip, slid (an undo step was taken by
   * onDragStart as the drag began). */
  onSlip?: (change: SlipChange) => void;
  /** Erase tool: a drag has passed over the clip; it goes when the drag
   * ends. */
  erasing?: boolean;
  /** The name the clip was given; unset, it shows what's in it. */
  name?: string;
  /** Being renamed: its name is a text field. */
  renaming?: boolean;
  /** The name typed (Enter or leaving the field), or null (Esc). */
  onRename?: (name: string | null) => void;
  /** Only drawn (a take's clip): no handles, and the pointer goes through
   * to what's under it. */
  passive?: boolean;
  /** A warped audio clip's warp (warp.ts): it shows its tempo. */
  warped?: WarpView;
  /** The clip's tempo typed into its badge. */
  onClipTempo?: (bpm: number) => void;
}

const MIN_MIDI = 36;
const MAX_MIDI = 96;
const LANE_PADDING = 10;
/** Lanes shorter than this draw clips as a bar, without notes or waveform. */
export const COMPACT_BELOW = 60;
const DOUBLE_CLICK_MS = 350;
const DRAG_THRESHOLD_PX = 3;
const MIN_RESIZE_SECONDS = 0.15;
const FADE_HANDLE_PX = 10;
const GAIN_DRAG_RANGE_PX = 100; // vertical pixels for a full +/-24dB sweep
const NO_SPANS: readonly ClipSpan[] = [];
const NO_SELECTION: ReadonlySet<string> = new Set();

/** A clip's tooltip with each tool. */
const TOOL_TITLES: Record<ClipTool, string> = {
  pointer: "Drag to move · drag right edge to resize (both snap to the grid and to other clips' edges; Alt: free) · click twice to edit · Ctrl/Cmd-click to multi-select · right-click for options",
  draw: "Drag to move · drag right edge to resize (both snap to the grid and to other clips' edges; Alt: free) · click twice to edit · Ctrl/Cmd-click to multi-select · right-click for options",
  split: "Click to split the clip here",
  erase: "Click to delete the clip, or drag across clips to delete them all",
  slip: "Drag to slide what's in the clip; the clip stays where it is",
};

export function noteNameToMidi(name: string): number {
  const match = name.match(/^([A-G]#?)(-?\d+)$/);
  if (!match) return 60;
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const [, pitch, octave] = match;
  return NOTE_NAMES.indexOf(pitch) + (parseInt(octave, 10) + 1) * 12;
}

function formatGain(db: number): string {
  return `${db >= 0 ? "+" : ""}${db.toFixed(1)}dB`;
}

export function ClipBlock({
  clipType = "midi",
  notes,
  audioPeaks,
  audioFileName,
  audioUrl,
  loopLength = null,
  durationSeconds = 0,
  sourceOffset = 0,
  fadeIn = 0,
  fadeOut = 0,
  gainDb = 0,
  onFadeChange,
  onGainChange,
  loop = false,
  color,
  offset,
  length,
  pxPerSecond,
  grid = NO_GRID,
  snapSpans = NO_SPANS,
  selection = NO_SELECTION,
  selected,
  onSelect,
  onEdit,
  onMove,
  onResize,
  onContextMenu,
  onDragStart,
  rowHeight = TRACK_ROW_HEIGHT,
  clipId,
  tool = "pointer",
  onSplitAt,
  onEraseStart,
  onSlip,
  erasing = false,
  name,
  renaming = false,
  onRename,
  passive = false,
  warped,
  onClipTempo,
}: ClipBlockProps) {
  const [typingTempo, setTypingTempo] = useState(false);
  const compact = rowHeight < COMPACT_BELOW;
  const pad = compact ? 3 : LANE_PADDING;
  const laneHeight = rowHeight - pad * 2 - 18;
  const lastClickAt = useRef(0);

  const snap = grid.snap;
  const minLength = grid.stepAt(offset) || MIN_RESIZE_SECONDS;
  /** The other clips' edges a drag snaps to, when the grid's on: not those
   * moving with it (the selection, when it's in it). */
  const edgesFor = (moving: ReadonlySet<string>) => (grid.stepBeats > 0 ? snapEdges(snapSpans, moving) : []);
  const reach = EDGE_SNAP_PX / pxPerSecond;
  /** A distance on the grid: whole grid steps (from the grid line nearest
   * where it starts). */
  const snapDistance = (from: number, distance: number) => {
    const base = snap(from);
    return snap(base + distance) - base;
  };
  /** The pointer and draw tools keep the clip's own handles (resize,
   * fades, gain); the others act on the whole clip. */
  const handles = !passive && (tool === "pointer" || tool === "draw");

  /** Split tool: where a click at `clientX` cuts, as a time on the
   * timeline - snapped to the grid, unless that lands on or outside the
   * clip's ends. */
  const splitPoint = (clientX: number, box: DOMRect) => {
    const exact = offset + (clientX - box.left) / pxPerSecond;
    const snapped = snap(exact);
    return snapped > offset && snapped < offset + length ? snapped : exact;
  };
  /** Split tool: where the cut would go, from the clip's start (s). */
  const [cutAt, setCutAt] = useState<number | null>(null);

  /** Slip tool: drag to slide the clip's content; the clip stays put. */
  const handleSlipPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startClientX = e.clientX;
    const startSource = sourceOffset;
    const startNotes = notes;
    // An audio clip's content can slide until its file runs out (a warped
    // one's moves at the speed it plays its file).
    const speed = warped?.speed ?? 1;
    const unit = loopLength && loopLength > 0 ? loopLength : length;
    const maxSource = Math.max(0, durationSeconds - unit * speed);
    let moved = false;
    const onMoveEvt = (ev: PointerEvent) => {
      const dx = ev.clientX - startClientX;
      if (!moved && Math.abs(dx) <= DRAG_THRESHOLD_PX) return;
      if (!moved) onDragStart?.();
      moved = true;
      const shift = snapDistance(offset, dx / pxPerSecond);
      if (clipType === "audio") onSlip?.({ sourceOffset: Math.min(maxSource, Math.max(0, startSource - shift * speed)) });
      else onSlip?.({ notes: startNotes.map((n) => ({ ...n, time: n.time + shift })) });
    };
    const onUp = () => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener("pointermove", onMoveEvt);
      target.removeEventListener("pointerup", onUp);
    };
    target.addEventListener("pointermove", onMoveEvt);
    target.addEventListener("pointerup", onUp);
  };

  const handleBodyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (tool === "split") {
      onSplitAt?.(splitPoint(e.clientX, e.currentTarget.getBoundingClientRect()));
      return;
    }
    // No pointer capture: the drag goes on across other clips.
    if (tool === "erase") return onEraseStart?.();
    if (tool === "slip") return handleSlipPointerDown(e);
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startClientX = e.clientX;
    const startOffset = offset;
    let moved = false;
    let finalOffset = offset;
    const edges = edgesFor(clipId && selection.size > 1 && selection.has(clipId) ? selection : new Set(clipId ? [clipId] : []));

    const onMoveEvt = (ev: PointerEvent) => {
      const deltaSeconds = (ev.clientX - startClientX) / pxPerSecond;
      if (Math.abs(ev.clientX - startClientX) > DRAG_THRESHOLD_PX) {
        if (!moved) onDragStart?.();
        moved = true;
      }
      if (!moved) return;
      const exact = startOffset + deltaSeconds;
      finalOffset = ev.altKey ? Math.max(0, exact) : snapMove(exact, length, edges, reach, snap);
      onMove(finalOffset);
    };
    const onUp = (ev: PointerEvent) => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener("pointermove", onMoveEvt);
      target.removeEventListener("pointerup", onUp);
      if (!moved) {
        // A Ctrl/Cmd-click picks the clip, never makes a double-click.
        const additive = ev.ctrlKey || ev.metaKey;
        const now = Date.now();
        if (!additive && now - lastClickAt.current < DOUBLE_CLICK_MS) {
          onEdit();
          lastClickAt.current = 0;
        } else {
          onSelect(additive);
          lastClickAt.current = additive ? 0 : now;
        }
      }
    };
    target.addEventListener("pointermove", onMoveEvt);
    target.addEventListener("pointerup", onUp);
  };

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startClientX = e.clientX;
    const startLength = length;
    let started = false;
    const edges = edgesFor(new Set(clipId ? [clipId] : []));

    const onMoveEvt = (ev: PointerEvent) => {
      if (!started) {
        started = true;
        onDragStart?.();
      }
      const deltaSeconds = (ev.clientX - startClientX) / pxPerSecond;
      const exact = startLength + deltaSeconds;
      if (ev.altKey) return onResize(Math.max(MIN_RESIZE_SECONDS, exact));
      const end = snapEnd(offset + exact, edges, reach, offset + minLength, (e) => offset + snapDistance(offset, e - offset));
      onResize(Math.max(minLength, end - offset));
    };
    const onUp = () => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener("pointermove", onMoveEvt);
      target.removeEventListener("pointerup", onUp);
    };
    target.addEventListener("pointermove", onMoveEvt);
    target.addEventListener("pointerup", onUp);
  };

  /** Drag the top-left (fade-in) or top-right (fade-out) corner handle. */
  const handleFadePointerDown = (e: React.PointerEvent<HTMLDivElement>, edge: "in" | "out") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startClientX = e.clientX;
    const startFadeIn = fadeIn;
    const startFadeOut = fadeOut;
    let started = false;

    const onMoveEvt = (ev: PointerEvent) => {
      if (!started) {
        started = true;
        onDragStart?.();
      }
      const deltaSeconds = (ev.clientX - startClientX) / pxPerSecond;
      if (edge === "in") {
        const next = Math.min(length, Math.max(0, startFadeIn + deltaSeconds));
        onFadeChange?.(next, fadeOut);
      } else {
        const next = Math.min(length, Math.max(0, startFadeOut - deltaSeconds));
        onFadeChange?.(fadeIn, next);
      }
    };
    const onUp = () => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener("pointermove", onMoveEvt);
      target.removeEventListener("pointerup", onUp);
    };
    target.addEventListener("pointermove", onMoveEvt);
    target.addEventListener("pointerup", onUp);
  };

  /** Drag the gain readout vertically to adjust this clip's own gain. */
  const handleGainPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startClientY = e.clientY;
    const startGain = gainDb;
    let started = false;

    const onMoveEvt = (ev: PointerEvent) => {
      if (!started) {
        started = true;
        onDragStart?.();
      }
      const delta = startClientY - ev.clientY;
      const next = Math.min(24, Math.max(-24, startGain + (delta / GAIN_DRAG_RANGE_PX) * 24));
      onGainChange?.(next);
    };
    const onUp = () => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener("pointermove", onMoveEvt);
      target.removeEventListener("pointerup", onUp);
    };
    target.addEventListener("pointermove", onMoveEvt);
    target.addEventListener("pointerup", onUp);
  };

  // Notes slid before the clip's start (slip tool) stay in the clip, unseen
  // and unplayed, until they're slid back.
  const visibleNotes = useMemo(
    () => notes.filter((n) => n.time >= 0 && n.time < length),
    [notes, length]
  );

  const waveform = useWaveform(clipType === "audio" ? audioUrl : undefined, audioPeaks, durationSeconds);

  const widthPx = length * pxPerSecond;
  const fadeInPx = Math.min(widthPx, fadeIn * pxPerSecond);
  const fadeOutPx = Math.min(widthPx, fadeOut * pxPerSecond);

  return (
    <div
      onPointerDown={handleBodyPointerDown}
      onClick={(e) => e.stopPropagation()}
      onPointerMove={tool === "split" ? (e) => setCutAt(splitPoint(e.clientX, e.currentTarget.getBoundingClientRect()) - offset) : undefined}
      onPointerLeave={() => setCutAt(null)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e);
      }}
      data-clip-id={passive ? undefined : clipId}
      data-take-clip={passive ? clipId : undefined}
      title={passive ? undefined : clipType === "audio" && handles ? TOOL_TITLES[tool].replace("click twice to edit", "click twice to rename") : TOOL_TITLES[tool]}
      className={`group absolute flex flex-col overflow-hidden rounded-md border transition-colors ${passive ? "pointer-events-none" : "cursor-grab active:cursor-grabbing"} ${
        selected ? "ring-2 ring-accent" : ""
      } ${erasing ? "opacity-30 outline outline-2 outline-record" : ""}`}
      style={{
        left: offset * pxPerSecond,
        top: pad,
        width: widthPx,
        height: rowHeight - pad * 2,
        borderColor: color.accent,
        background: color.accentSoft,
        cursor: tool === "pointer" ? undefined : TOOL_CURSORS[tool],
      }}
    >
      <div
        className={`flex items-center justify-between gap-1 px-1.5 py-0.5 text-[10px] ${compact ? "h-full" : ""}`}
        style={{ background: color.accent, color: "#0a0a0a" }}
      >
        <span className="flex min-w-0 items-center gap-1 truncate">
          {loop && (
            <span title="Looping" className="shrink-0">
              <Repeat size={9} />
            </span>
          )}
          {warped &&
            (typingTempo ? (
              <TempoField
                bpm={warped.bpm}
                onDone={(value) => {
                  setTypingTempo(false);
                  if (value !== null) onClipTempo?.(value);
                }}
              />
            ) : (
              <button
                type="button"
                aria-label={`Clip tempo ${formatBpm(warped.bpm)} BPM`}
                title={`Warped (${warped.mode === "repitch" ? "repitch" : "stretch"}): it follows the song's tempo. Its own tempo is ${formatBpm(warped.bpm)} BPM - click to type it`}
                className="shrink-0 rounded-sm bg-black/20 px-1 font-mono text-[9px] leading-[13px]"
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!passive && onClipTempo) setTypingTempo(true);
                }}
              >
                {formatBpm(warped.bpm)}
              </button>
            ))}
          {renaming ? (
            <RenameField name={name ?? ""} onDone={(value) => onRename?.(value)} />
          ) : (
            <span className="truncate">
              {name ??
                (clipType === "audio"
                  ? audioFileName ?? "audio"
                  : notes.length > 0
                    ? `${notes.length} notes`
                    : "empty")}
            </span>
          )}
        </span>
        {clipType === "audio" && handles ? (
          <div
            onPointerDown={handleGainPointerDown}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onGainChange?.(0);
            }}
            title="Drag to adjust this clip's gain · double-click to reset"
            className="shrink-0 cursor-ns-resize select-none rounded px-1 font-mono opacity-0 group-hover:opacity-100"
          >
            {formatGain(gainDb)}
          </div>
        ) : clipType === "midi" && handles ? (
          <span className="shrink-0 opacity-0 group-hover:opacity-100">dbl-click to edit</span>
        ) : null}
      </div>
      {!compact && (
      <div className="relative flex-1">
        {clipType === "audio" ? (
          <WaveformCanvas
            waveform={waveform}
            width={widthPx}
            height={laneHeight}
            view={{
              pxPerSecond,
              sourceOffset,
              loopLength,
              length,
              gain: Math.pow(10, gainDb / 20),
              fadeIn,
              fadeOut,
              color: color.accent,
              pieces: warped?.pieces,
            }}
          />
        ) : (
          visibleNotes.map((n, i) => {
              const midi = noteNameToMidi(n.note);
              const x = (n.time / length) * 100;
              const w = Math.max((n.duration / length) * 100, 0.5);
              const y =
                laneHeight -
                ((midi - MIN_MIDI) / (MAX_MIDI - MIN_MIDI)) * laneHeight;
              return (
                <div
                  key={i}
                  className="absolute h-[2px] rounded-full"
                  style={{
                    left: `${x}%`,
                    width: `${w}%`,
                    top: Math.min(Math.max(y, 0), laneHeight - 2),
                    background: color.accent,
                  }}
                />
              );
            })
        )}
        {clipType === "audio" && warped && warped.markers.length > 0 && (
          // Its warp markers (a quantize's), as faint lines.
          <div className="pointer-events-none absolute inset-0" data-warp-markers={warped.markers.length}>
            {warped.markers.map((t, i) => (
              <span key={i} className="absolute top-0 h-full w-px opacity-40" style={{ left: t * pxPerSecond, background: color.accent }} />
            ))}
          </div>
        )}
        {clipType === "audio" && (fadeInPx > 0 || fadeOutPx > 0) && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox={`0 0 ${widthPx} ${laneHeight}`}
            preserveAspectRatio="none"
          >
            {fadeInPx > 0 && (
              <polygon points={`0,0 ${fadeInPx},0 0,${laneHeight}`} fill="rgba(0,0,0,0.35)" />
            )}
            {fadeOutPx > 0 && (
              <polygon
                points={`${widthPx},0 ${widthPx - fadeOutPx},0 ${widthPx},${laneHeight}`}
                fill="rgba(0,0,0,0.35)"
              />
            )}
          </svg>
        )}
      </div>
      )}
      {tool === "split" && cutAt !== null && (
        <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]" style={{ left: cutAt * pxPerSecond }} />
      )}
      {handles && (
        <div
          onPointerDown={handleResizePointerDown}
          title="Drag to resize the clip length"
          className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-black/0 hover:bg-black/30"
        />
      )}
      {clipType === "audio" && handles && (
        <>
          <div
            onPointerDown={(e) => handleFadePointerDown(e, "in")}
            title="Drag to set the fade-in"
            className="absolute left-0 top-0 z-10 cursor-ew-resize opacity-0 group-hover:opacity-100"
            style={{ width: FADE_HANDLE_PX, height: FADE_HANDLE_PX }}
          >
            <div className="h-full w-full rounded-br-full bg-white/70" />
          </div>
          <div
            onPointerDown={(e) => handleFadePointerDown(e, "out")}
            title="Drag to set the fade-out"
            className="absolute right-0 top-0 z-10 cursor-ew-resize opacity-0 group-hover:opacity-100"
            style={{ width: FADE_HANDLE_PX, height: FADE_HANDLE_PX }}
          >
            <div className="h-full w-full rounded-bl-full bg-white/70" />
          </div>
        </>
      )}
    </div>
  );
}

/** A clip's name, being typed: Enter or leaving the field keeps it, Esc
 * doesn't. Keys and clicks stay in the field. */
/** Typing a warped clip's own tempo: Enter (or leaving it) sets it, Escape
 * doesn't. */
function TempoField({ bpm, onDone }: { bpm: number; onDone: (bpm: number | null) => void }) {
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    const parsed = value === null ? NaN : Number(value);
    onDone(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
  };
  return (
    <input
      autoFocus
      aria-label="Clip tempo (BPM)"
      defaultValue={formatBpm(bpm)}
      inputMode="decimal"
      onFocus={(e) => e.currentTarget.select()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        else if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      className="h-4 w-10 shrink-0 rounded-sm bg-black/25 px-1 font-mono text-[10px] text-black outline-none"
    />
  );
}

function RenameField({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  return (
    <input
      autoFocus
      aria-label="Clip name"
      defaultValue={name}
      maxLength={MAX_CLIP_NAME}
      onFocus={(e) => e.currentTarget.select()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        else if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      className="h-4 min-w-0 flex-1 rounded-sm bg-black/25 px-1 text-[10px] text-black outline-none placeholder:text-black/50"
      placeholder="Name"
    />
  );
}
