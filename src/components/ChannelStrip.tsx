"use client";

import { useRef } from "react";
import { Knob } from "./Knob";
import { Meter } from "./Meter";
import { PianoRoll } from "./PianoRoll";
import type { ChannelConfig, NoteEvent } from "@/lib/types";

interface ChannelStripProps {
  channel: ChannelConfig;
  notes: NoteEvent[];
  selected: boolean;
  recording: boolean;
  canRemove: boolean;
  onSelect: () => void;
  onVolumeChange: (db: number) => void;
  onPanChange: (pan: number) => void;
  onImportMidi: (file: File) => void;
  onExportMidi: () => void;
  onClearClip: () => void;
  onRemove: () => void;
}

function formatDb(db: number): string {
  return db <= -60 ? "-∞ dB" : `${db.toFixed(1)} dB`;
}

function formatPan(pan: number): string {
  if (Math.abs(pan) < 0.02) return "C";
  return pan < 0 ? `${Math.round(-pan * 100)}L` : `${Math.round(pan * 100)}R`;
}

export function ChannelStrip({
  channel,
  notes,
  selected,
  recording,
  canRemove,
  onSelect,
  onVolumeChange,
  onPanChange,
  onImportMidi,
  onExportMidi,
  onClearClip,
  onRemove,
}: ChannelStripProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className={`flex w-44 shrink-0 flex-col gap-3 rounded-lg border p-3 transition-colors ${
        selected
          ? "border-accent bg-surface-raised"
          : "border-border bg-surface"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex items-center justify-between gap-2 text-left"
      >
        <span className="truncate text-sm font-medium">{channel.name}</span>
        {recording && (
          <span className="h-2.5 w-2.5 shrink-0 animate-pulse-rec rounded-full bg-record" />
        )}
      </button>

      <PianoRoll notes={notes} />

      <div className="flex items-center justify-between gap-3">
        <Knob
          label="Pan"
          value={channel.pan}
          min={-1}
          max={1}
          defaultValue={0}
          onChange={onPanChange}
          formatValue={formatPan}
        />
        <Knob
          label="Volume"
          value={channel.volume}
          min={-60}
          max={6}
          defaultValue={0}
          onChange={onVolumeChange}
          formatValue={formatDb}
        />
        <Meter channelId={channel.id} />
      </div>

      <div className="flex flex-col gap-1.5 text-xs">
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 rounded border border-border px-2 py-1 hover:bg-surface-raised"
          >
            Import .mid
          </button>
          <button
            type="button"
            onClick={onExportMidi}
            disabled={notes.length === 0}
            className="flex-1 rounded border border-border px-2 py-1 hover:bg-surface-raised disabled:opacity-30"
          >
            Export .mid
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".mid,.midi,audio/midi"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportMidi(file);
            e.target.value = "";
          }}
        />
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onClearClip}
            disabled={notes.length === 0}
            className="flex-1 rounded border border-border px-2 py-1 hover:bg-surface-raised disabled:opacity-30"
          >
            Clear
          </button>
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="flex-1 rounded border border-border px-2 py-1 text-record hover:bg-surface-raised"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
