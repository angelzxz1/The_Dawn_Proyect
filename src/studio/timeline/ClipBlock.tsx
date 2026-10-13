"use client";

import { useMemo, useRef, useState } from "react";
import { Repeat } from "lucide-react";
import type { ClipType, NoteEvent } from "@/project/types";
import type { TrackColor } from "@/project/colors";
import { TRACK_ROW_HEIGHT } from "./layout";
import { WaveformCanvas, useWaveform } from "./WaveformCanvas";
import { TOOL_CURSORS, type ClipTool } from "./clipTools";

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
  /** Grid size (seconds) a drag snaps to; 0/undefined means free (no
   * snapping) - drag position follows the pointer exactly. */
  snapSeconds?: number;
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

/** A clip's tooltip with each tool. */
const TOOL_TITLES: Record<ClipTool, string> = {
  pointer: "Drag to move · drag right edge to resize · click twice to edit · Ctrl/Cmd-click to multi-select · right-click for options",
  draw: "Drag to move · drag right edge to resize · click twice to edit · Ctrl/Cmd-click to multi-select · right-click for options",
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
  snapSeconds,
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
}: ClipBlockProps) {
  const compact = rowHeight < COMPACT_BELOW;
  const pad = compact ? 3 : LANE_PADDING;
  const laneHeight = rowHeight - pad * 2 - 18;
  const lastClickAt = useRef(0);

  const grid = snapSeconds && snapSeconds > 0 ? snapSeconds : null;
  const snap = (seconds: number) => (grid ? Math.round(seconds / grid) * grid : seconds);
  const minLength = grid ?? MIN_RESIZE_SECONDS;
  /** The pointer and draw tools keep the clip's own handles (resize,
   * fades, gain); the others act on the whole clip. */
  const handles = tool === "pointer" || tool === "draw";

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
    // An audio clip's content can slide until its file runs out.
    const unit = loopLength && loopLength > 0 ? loopLength : length;
    const maxSource = Math.max(0, durationSeconds - unit);
    let moved = false;
    const onMoveEvt = (ev: PointerEvent) => {
      const dx = ev.clientX - startClientX;
      if (!moved && Math.abs(dx) <= DRAG_THRESHOLD_PX) return;
      if (!moved) onDragStart?.();
      moved = true;
      const shift = snap(dx / pxPerSecond);
      if (clipType === "audio") onSlip?.({ sourceOffset: Math.min(maxSource, Math.max(0, startSource - shift)) });
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

    const onMoveEvt = (ev: PointerEvent) => {
      const deltaSeconds = (ev.clientX - startClientX) / pxPerSecond;
      if (Math.abs(ev.clientX - startClientX) > DRAG_THRESHOLD_PX) {
        if (!moved) onDragStart?.();
        moved = true;
      }
      if (!moved) return;
      finalOffset = Math.max(0, snap(startOffset + deltaSeconds));
      onMove(finalOffset);
    };
    const onUp = (ev: PointerEvent) => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener("pointermove", onMoveEvt);
      target.removeEventListener("pointerup", onUp);
      if (!moved) {
        const now = Date.now();
        if (now - lastClickAt.current < DOUBLE_CLICK_MS) {
          onEdit();
          lastClickAt.current = 0;
        } else {
          onSelect(ev.ctrlKey || ev.metaKey);
          lastClickAt.current = now;
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

    const onMoveEvt = (ev: PointerEvent) => {
      if (!started) {
        started = true;
        onDragStart?.();
      }
      const deltaSeconds = (ev.clientX - startClientX) / pxPerSecond;
      const newLength = Math.max(minLength, snap(startLength + deltaSeconds));
      onResize(newLength);
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
      data-clip-id={clipId}
      title={TOOL_TITLES[tool]}
      className={`group absolute flex cursor-grab flex-col overflow-hidden rounded-md border transition-colors active:cursor-grabbing ${
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
          <span className="truncate">
            {clipType === "audio"
              ? audioFileName ?? "audio"
              : notes.length > 0
                ? `${notes.length} notes`
                : "empty"}
          </span>
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
