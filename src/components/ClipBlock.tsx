"use client";

import { useMemo, useRef } from "react";
import type { ClipType, NoteEvent } from "@/lib/types";
import type { TrackColor } from "@/lib/colors";
import { TRACK_ROW_HEIGHT, secondsPerBar } from "@/lib/timeline";

interface ClipBlockProps {
  clipType?: ClipType;
  notes: NoteEvent[];
  /** Waveform peaks (0..1) for an audio clip, and the source file's name. */
  audioPeaks?: number[];
  audioFileName?: string;
  color: TrackColor;
  offset: number;
  length: number;
  bpm: number;
  beatsPerBar: number;
  pxPerSecond: number;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onMove: (offsetSeconds: number) => void;
  onResize: (lengthSeconds: number) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const MIN_MIDI = 36;
const MAX_MIDI = 96;
const LANE_PADDING = 10;
const DOUBLE_CLICK_MS = 350;
const DRAG_THRESHOLD_PX = 3;

function noteNameToMidi(name: string): number {
  const match = name.match(/^([A-G]#?)(-?\d+)$/);
  if (!match) return 60;
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const [, pitch, octave] = match;
  return NOTE_NAMES.indexOf(pitch) + (parseInt(octave, 10) + 1) * 12;
}

export function ClipBlock({
  clipType = "midi",
  notes,
  audioPeaks,
  audioFileName,
  color,
  offset,
  length,
  bpm,
  beatsPerBar,
  pxPerSecond,
  selected,
  onSelect,
  onEdit,
  onMove,
  onResize,
  onContextMenu,
}: ClipBlockProps) {
  const laneHeight = TRACK_ROW_HEIGHT - LANE_PADDING * 2 - 18;
  const lastClickAt = useRef(0);

  const bar = secondsPerBar(bpm, beatsPerBar);
  const snap = (seconds: number) => Math.round(seconds / bar) * bar;

  const handleBodyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startClientX = e.clientX;
    const startOffset = offset;
    let moved = false;
    let finalOffset = offset;

    const onMoveEvt = (ev: PointerEvent) => {
      const deltaSeconds = (ev.clientX - startClientX) / pxPerSecond;
      if (Math.abs(ev.clientX - startClientX) > DRAG_THRESHOLD_PX) moved = true;
      if (!moved) return;
      finalOffset = Math.max(0, snap(startOffset + deltaSeconds));
      onMove(finalOffset);
    };
    const onUp = () => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener("pointermove", onMoveEvt);
      target.removeEventListener("pointerup", onUp);
      if (!moved) {
        const now = Date.now();
        if (now - lastClickAt.current < DOUBLE_CLICK_MS) {
          onEdit();
          lastClickAt.current = 0;
        } else {
          onSelect();
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

    const onMoveEvt = (ev: PointerEvent) => {
      const deltaSeconds = (ev.clientX - startClientX) / pxPerSecond;
      const newLength = Math.max(bar, snap(startLength + deltaSeconds));
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

  const visibleNotes = useMemo(
    () => notes.filter((n) => n.time < length),
    [notes, length]
  );

  return (
    <div
      onPointerDown={handleBodyPointerDown}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e);
      }}
      title="Drag to move · drag right edge to resize · click twice to edit · right-click for options"
      className={`group absolute top-2.5 flex cursor-grab flex-col overflow-hidden rounded-md border transition-colors active:cursor-grabbing ${
        selected ? "ring-2 ring-accent" : ""
      }`}
      style={{
        left: offset * pxPerSecond,
        width: length * pxPerSecond,
        height: TRACK_ROW_HEIGHT - LANE_PADDING * 2,
        borderColor: color.accent,
        background: color.accentSoft,
      }}
    >
      <div
        className="flex items-center justify-between gap-1 px-1.5 py-0.5 text-[10px]"
        style={{ background: color.accent, color: "#0a0a0a" }}
      >
        <span className="truncate">
          {clipType === "audio"
            ? audioFileName ?? "audio"
            : notes.length > 0
              ? `${notes.length} notes`
              : "empty"}
        </span>
        <span className="shrink-0 opacity-0 group-hover:opacity-100">
          drag · {clipType === "midi" ? "dbl-click to edit" : "resize to trim"}
        </span>
      </div>
      <div className="relative flex-1">
        {clipType === "audio"
          ? (audioPeaks ?? []).map((peak, i, arr) => (
              <div
                key={i}
                className="absolute bottom-0 rounded-t-sm"
                style={{
                  left: `${(i / arr.length) * 100}%`,
                  width: `${100 / arr.length}%`,
                  height: `${Math.max(peak, 0.04) * laneHeight}px`,
                  background: color.accent,
                  opacity: 0.75,
                }}
              />
            ))
          : visibleNotes.map((n, i) => {
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
            })}
      </div>
      <div
        onPointerDown={handleResizePointerDown}
        title="Drag to resize the clip length"
        className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-black/0 hover:bg-black/30"
      />
    </div>
  );
}
