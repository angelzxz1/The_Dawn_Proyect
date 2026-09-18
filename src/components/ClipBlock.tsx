"use client";

import { useMemo } from "react";
import type { NoteEvent } from "@/lib/types";
import type { TrackColor } from "@/lib/colors";
import { MIN_EMPTY_CLIP_SECONDS, TRACK_ROW_HEIGHT } from "@/lib/timeline";

interface ClipBlockProps {
  notes: NoteEvent[];
  color: TrackColor;
  pxPerSecond: number;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
}

const MIN_MIDI = 36;
const MAX_MIDI = 96;
const LANE_PADDING = 10;

function noteNameToMidi(name: string): number {
  const match = name.match(/^([A-G]#?)(-?\d+)$/);
  if (!match) return 60;
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const [, pitch, octave] = match;
  return NOTE_NAMES.indexOf(pitch) + (parseInt(octave, 10) + 1) * 12;
}

export function ClipBlock({
  notes,
  color,
  pxPerSecond,
  selected,
  onSelect,
  onEdit,
}: ClipBlockProps) {
  const duration = useMemo(
    () => notes.reduce((max, n) => Math.max(max, n.time + n.duration), 0),
    [notes]
  );
  const clipSeconds = Math.max(duration, MIN_EMPTY_CLIP_SECONDS);
  const laneHeight = TRACK_ROW_HEIGHT - LANE_PADDING * 2 - 18;

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onEdit();
      }}
      title="Double-click to edit in the piano roll"
      className={`group absolute top-2.5 flex cursor-pointer flex-col overflow-hidden rounded-md border transition-colors ${
        selected ? "ring-2 ring-accent" : ""
      }`}
      style={{
        left: 0,
        width: clipSeconds * pxPerSecond,
        height: TRACK_ROW_HEIGHT - LANE_PADDING * 2,
        borderColor: color.accent,
        background: color.accentSoft,
      }}
    >
      <div
        className="flex items-center justify-between px-1.5 py-0.5 text-[10px]"
        style={{ background: color.accent, color: "#0a0a0a" }}
      >
        <span>{notes.length > 0 ? `${notes.length} notes` : "empty"}</span>
        <span className="opacity-0 group-hover:opacity-100">double-click to edit</span>
      </div>
      <div className="relative flex-1">
        {notes.map((n, i) => {
          const midi = noteNameToMidi(n.note);
          const x = (n.time / clipSeconds) * 100;
          const w = Math.max((n.duration / clipSeconds) * 100, 0.5);
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
    </div>
  );
}
