"use client";

import { Circle, Play, Square, Volume1, Volume2 } from "lucide-react";
import { TransportClock } from "./TransportClock";
import type { TimeSignature } from "@/lib/types";

const DENOMINATORS = [1, 2, 4, 8, 16, 32];

interface TransportBarProps {
  bpm: number;
  onBpmChange: (bpm: number) => void;
  timeSignature: TimeSignature;
  onTimeSignatureChange: (ts: TimeSignature) => void;
  metronomeEnabled: boolean;
  onToggleMetronome: () => void;
  isPlaying: boolean;
  isRecording: boolean;
  selectedChannelName: string;
  onPlay: () => void;
  onStop: () => void;
  onRecord: () => void;
}

export function TransportBar({
  bpm,
  onBpmChange,
  timeSignature,
  onTimeSignatureChange,
  metronomeEnabled,
  onToggleMetronome,
  isPlaying,
  isRecording,
  selectedChannelName,
  onPlay,
  onStop,
  onRecord,
}: TransportBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRecord}
          aria-pressed={isRecording}
          title="Record onto the selected channel"
          className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
            isRecording
              ? "animate-pulse-rec border-record bg-record text-white"
              : "border-border text-record hover:bg-surface-raised"
          }`}
        >
          <Circle size={14} fill="currentColor" />
        </button>
        <button
          type="button"
          onClick={onPlay}
          disabled={isRecording}
          title="Play"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-success hover:bg-surface-raised disabled:opacity-30"
        >
          <Play size={15} fill="currentColor" />
        </button>
        <button
          type="button"
          onClick={onStop}
          title="Stop"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border hover:bg-surface-raised"
        >
          <Square size={13} fill="currentColor" />
        </button>
        <button
          type="button"
          onClick={onToggleMetronome}
          aria-pressed={metronomeEnabled}
          title="Metronome"
          className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
            metronomeEnabled
              ? "border-accent bg-accent/20 text-accent"
              : "border-border text-muted hover:bg-surface-raised"
          }`}
        >
          {metronomeEnabled ? <Volume2 size={15} /> : <Volume1 size={15} />}
        </button>
      </div>

      <TransportClock />

      <label className="flex items-center gap-2 text-xs text-muted">
        BPM
        <input
          type="number"
          min={20}
          max={300}
          value={bpm}
          onChange={(e) => onBpmChange(Number(e.target.value) || bpm)}
          className="w-16 rounded border border-border bg-surface-raised px-2 py-1 font-mono text-foreground"
        />
      </label>

      <label className="flex items-center gap-1.5 text-xs text-muted">
        Time sig.
        <input
          type="number"
          min={1}
          max={32}
          value={timeSignature.numerator}
          onChange={(e) =>
            onTimeSignatureChange({
              ...timeSignature,
              numerator: Math.max(1, Number(e.target.value) || timeSignature.numerator),
            })
          }
          className="w-12 rounded border border-border bg-surface-raised px-1.5 py-1 text-center font-mono text-foreground"
        />
        <span>/</span>
        <select
          value={timeSignature.denominator}
          onChange={(e) =>
            onTimeSignatureChange({
              ...timeSignature,
              denominator: Number(e.target.value),
            })
          }
          className="rounded border border-border bg-surface-raised px-1.5 py-1 font-mono text-foreground"
        >
          {DENOMINATORS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>

      <div className="text-xs text-muted">
        {isPlaying
          ? "playing"
          : isRecording
            ? `recording onto ${selectedChannelName}`
            : "stopped"}{" "}
        · armed channel:{" "}
        <span className="text-foreground">{selectedChannelName}</span>
      </div>
    </div>
  );
}
