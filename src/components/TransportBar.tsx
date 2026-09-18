"use client";

interface TransportBarProps {
  bpm: number;
  onBpmChange: (bpm: number) => void;
  isPlaying: boolean;
  isRecording: boolean;
  elapsedSeconds: number;
  selectedChannelName: string;
  onPlay: () => void;
  onStop: () => void;
  onRecord: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, "0")}.${ms}`;
}

export function TransportBar({
  bpm,
  onBpmChange,
  isPlaying,
  isRecording,
  elapsedSeconds,
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
          ●
        </button>
        <button
          type="button"
          onClick={onPlay}
          disabled={isRecording}
          title="Play"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-success hover:bg-surface-raised disabled:opacity-30"
        >
          ▶
        </button>
        <button
          type="button"
          onClick={onStop}
          title="Stop"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border hover:bg-surface-raised"
        >
          ■
        </button>
      </div>

      <div className="font-mono text-sm text-muted">
        {formatTime(elapsedSeconds)}
      </div>

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
