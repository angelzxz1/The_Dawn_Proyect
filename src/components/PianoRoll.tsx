"use client";

import { useMemo } from "react";
import type { NoteEvent } from "@/lib/types";

interface PianoRollProps {
  notes: NoteEvent[];
  playheadSeconds?: number;
}

const MIN_MIDI = 36; // C2
const MAX_MIDI = 96; // C7
const MIN_DURATION_SHOWN = 4; // seconds, minimum time window drawn

function noteNameToMidi(name: string): number {
  const match = name.match(/^([A-G]#?)(-?\d+)$/);
  if (!match) return 60;
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const [, pitch, octave] = match;
  return NOTE_NAMES.indexOf(pitch) + (parseInt(octave, 10) + 1) * 12;
}

export function PianoRoll({ notes, playheadSeconds }: PianoRollProps) {
  const totalDuration = useMemo(() => {
    const end = notes.reduce((max, n) => Math.max(max, n.time + n.duration), 0);
    return Math.max(end, MIN_DURATION_SHOWN);
  }, [notes]);

  const pitchRange = MAX_MIDI - MIN_MIDI;

  return (
    <div className="relative h-16 w-full overflow-hidden rounded border border-border bg-black/40">
      {notes.length === 0 ? (
        <div className="flex h-full items-center justify-center text-[11px] text-muted">
          no notes recorded yet
        </div>
      ) : (
        <svg
          viewBox={`0 0 100 100`}
          preserveAspectRatio="none"
          className="h-full w-full"
        >
          {notes.map((n, i) => {
            const midi = noteNameToMidi(n.note);
            const x = (n.time / totalDuration) * 100;
            const w = Math.max((n.duration / totalDuration) * 100, 0.6);
            const y = 100 - ((midi - MIN_MIDI) / pitchRange) * 100;
            return (
              <rect
                key={i}
                x={x}
                y={y - 1.2}
                width={w}
                height={2.4}
                rx={0.5}
                fill="#5eb1ff"
              />
            );
          })}
          {playheadSeconds !== undefined && (
            <line
              x1={(playheadSeconds / totalDuration) * 100}
              x2={(playheadSeconds / totalDuration) * 100}
              y1={0}
              y2={100}
              stroke="#ff5a5a"
              strokeWidth={0.6}
            />
          )}
        </svg>
      )}
    </div>
  );
}
