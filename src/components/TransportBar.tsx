"use client";

import { Circle, Play, Square } from "lucide-react";
import { TransportClock } from "./TransportClock";

interface TransportBarProps {
  bpm: number;
  onBpmChange: (bpm: number) => void;
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
