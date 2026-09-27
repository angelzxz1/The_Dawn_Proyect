"use client";

import { useEffect, useState } from "react";
import { Circle, Pause, Play, Repeat, Square, Volume1, Volume2 } from "lucide-react";
import { TransportClock } from "./TransportClock";
import type { TimeSignature } from "@/lib/types";

const DENOMINATORS = [1, 2, 4, 8, 16, 32];
const COUNT_IN_OPTIONS = [0, 1, 2, 4];

interface TransportBarProps {
  bpm: number;
  /** Fires once when the field is committed (blur/Enter), not per keystroke
   * - so tempo edits collapse into a single undo step. */
  onBpmChange: (bpm: number) => void;
  timeSignature: TimeSignature;
  onTimeSignatureChange: (ts: TimeSignature) => void;
  metronomeEnabled: boolean;
  onToggleMetronome: () => void;
  isPlaying: boolean;
  isPaused: boolean;
  isRecording: boolean;
  /** False disables the Record button - nothing is armed, so there's
   * nothing for it to capture. */
  canRecord: boolean;
  /** What the armed channel will capture when Record is pressed. */
  recordingMode?: "midi" | "audio";
  /** Name of the record-armed channel, or null if none is armed. */
  armedChannelName: string | null;
  loopEnabled: boolean;
  onToggleLoop: () => void;
  /** Bars of audible pre-roll clicks played before recording actually
   * starts - 0 disables count-in. */
  countInBars: number;
  onCountInChange: (bars: number) => void;
  onPlay: () => void;
  onPause: () => void;
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
  isPaused,
  isRecording,
  canRecord,
  recordingMode = "midi",
  armedChannelName,
  loopEnabled,
  onToggleLoop,
  countInBars,
  onCountInChange,
  onPlay,
  onPause,
  onStop,
  onRecord,
}: TransportBarProps) {
  const [bpmDraft, setBpmDraft] = useState(String(bpm));
  useEffect(() => setBpmDraft(String(bpm)), [bpm]);
  const commitBpm = () => {
    const parsed = Number(bpmDraft);
    if (Number.isFinite(parsed) && parsed > 0) onBpmChange(Math.min(300, Math.max(20, parsed)));
    else setBpmDraft(String(bpm));
  };

  const [numeratorDraft, setNumeratorDraft] = useState(String(timeSignature.numerator));
  useEffect(() => setNumeratorDraft(String(timeSignature.numerator)), [timeSignature.numerator]);
  const commitNumerator = () => {
    const parsed = Number(numeratorDraft);
    if (Number.isFinite(parsed) && parsed >= 1) {
      onTimeSignatureChange({ ...timeSignature, numerator: Math.max(1, Math.round(parsed)) });
    } else {
      setNumeratorDraft(String(timeSignature.numerator));
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRecord}
          disabled={!canRecord}
          aria-pressed={isRecording}
          title={
            !canRecord
              ? "Arm a track (click its Record button) before you can record"
              : recordingMode === "audio"
                ? `Record microphone input onto ${armedChannelName}`
                : `Record MIDI onto ${armedChannelName}`
          }
          className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors disabled:opacity-30 ${
            isRecording
              ? "animate-pulse-rec border-record bg-record text-white"
              : "border-border text-record hover:bg-surface-raised"
          }`}
        >
          <Circle size={14} fill="currentColor" />
        </button>
        <button
          type="button"
          onClick={isPlaying ? onPause : onPlay}
          disabled={isRecording}
          title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors disabled:opacity-30 ${
            isPlaying
              ? "border-accent bg-accent/20 text-accent"
              : "border-border text-success hover:bg-surface-raised"
          }`}
        >
          {isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
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
        <button
          type="button"
          onClick={onToggleLoop}
          aria-pressed={loopEnabled}
          title="Toggle looping the region set by shift-dragging the ruler"
          className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
            loopEnabled
              ? "border-accent bg-accent/20 text-accent"
              : "border-border text-muted hover:bg-surface-raised"
          }`}
        >
          <Repeat size={15} />
        </button>
      </div>

      <TransportClock />

      <label className="flex items-center gap-2 text-xs text-muted">
        BPM
        <input
          type="number"
          min={20}
          max={300}
          value={bpmDraft}
          onChange={(e) => setBpmDraft(e.target.value)}
          onBlur={commitBpm}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="w-16 rounded border border-border bg-surface-raised px-2 py-1 font-mono text-foreground"
        />
      </label>

      <label className="flex items-center gap-1.5 text-xs text-muted">
        Time sig.
        <input
          type="number"
          min={1}
          max={32}
          value={numeratorDraft}
          onChange={(e) => setNumeratorDraft(e.target.value)}
          onBlur={commitNumerator}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
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

      <label className="flex items-center gap-1.5 text-xs text-muted">
        Count-in
        <select
          value={countInBars}
          onChange={(e) => onCountInChange(Number(e.target.value))}
          title="Bars of audible pre-roll clicks before recording starts"
          className="rounded border border-border bg-surface-raised px-1.5 py-1 font-mono text-foreground"
        >
          {COUNT_IN_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n === 0 ? "Off" : `${n} bar${n > 1 ? "s" : ""}`}
            </option>
          ))}
        </select>
      </label>

      <div className="text-xs text-muted">
        {isPlaying
          ? "playing"
          : isRecording
            ? `recording ${recordingMode === "audio" ? "audio" : "MIDI"} onto ${armedChannelName}`
            : isPaused
              ? "paused"
              : "stopped"}{" "}
        · armed channel:{" "}
        <span className="text-foreground">{armedChannelName ?? "none"}</span>
      </div>
    </div>
  );
}
