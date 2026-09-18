"use client";

import { useRef } from "react";
import { Download, Pencil, Trash2, Upload, X } from "lucide-react";
import { ValueBar } from "./ValueBar";
import { Meter } from "./Meter";
import type { ChannelConfig } from "@/lib/types";
import type { TrackColor } from "@/lib/colors";
import { TRACK_HEADER_WIDTH, TRACK_ROW_HEIGHT } from "@/lib/timeline";

interface TrackHeaderProps {
  channel: ChannelConfig;
  color: TrackColor;
  selected: boolean;
  recording: boolean;
  hasNotes: boolean;
  canRemove: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onVolumeChange: (db: number) => void;
  onPanChange: (pan: number) => void;
  onImportMidi: (file: File) => void;
  onExportMidi: () => void;
  onClearClip: () => void;
  onRemove: () => void;
}

function formatDb(db: number): string {
  return db <= -60 ? "-∞" : `${db.toFixed(1)}dB`;
}

function formatPan(pan: number): string {
  if (Math.abs(pan) < 0.02) return "C";
  return pan < 0 ? `${Math.round(-pan * 100)}L` : `${Math.round(pan * 100)}R`;
}

function IconButton({
  title,
  onClick,
  disabled,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-6 w-6 items-center justify-center rounded border border-border hover:bg-surface-raised disabled:opacity-30 ${
        danger ? "text-record" : "text-muted"
      }`}
    >
      {children}
    </button>
  );
}

export function TrackHeader({
  channel,
  color,
  selected,
  recording,
  hasNotes,
  canRemove,
  onSelect,
  onEdit,
  onVolumeChange,
  onPanChange,
  onImportMidi,
  onExportMidi,
  onClearClip,
  onRemove,
}: TrackHeaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      onClick={onSelect}
      style={{ width: TRACK_HEADER_WIDTH, height: TRACK_ROW_HEIGHT }}
      className={`flex shrink-0 cursor-pointer flex-col gap-1.5 border-b border-r border-border p-2 transition-colors ${
        selected ? "bg-surface-raised" : "bg-surface hover:bg-surface-raised/60"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: color.accent }}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {channel.name}
        </span>
        {recording && (
          <span className="h-2 w-2 shrink-0 animate-pulse-rec rounded-full bg-record" />
        )}
        <button
          type="button"
          title="Open in piano roll editor"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border text-muted hover:bg-surface hover:text-accent"
        >
          <Pencil size={12} />
        </button>
      </div>

      <div
        className="flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1">
          <ValueBar
            label="Pan"
            value={channel.pan}
            min={-1}
            max={1}
            defaultValue={0}
            onChange={onPanChange}
            formatValue={formatPan}
            bipolar
          />
          <ValueBar
            label="Vol"
            value={channel.volume}
            min={-60}
            max={6}
            defaultValue={0}
            onChange={onVolumeChange}
            formatValue={formatDb}
          />
        </div>
        <div className="h-11">
          <Meter channelId={channel.id} />
        </div>
      </div>

      <div
        className="flex items-center gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        <IconButton title="Import .mid" onClick={() => fileInputRef.current?.click()}>
          <Upload size={12} />
        </IconButton>
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
        <IconButton title="Export .mid" onClick={onExportMidi} disabled={!hasNotes}>
          <Download size={12} />
        </IconButton>
        <IconButton title="Clear clip" onClick={onClearClip} disabled={!hasNotes}>
          <Trash2 size={12} />
        </IconButton>
        <div className="flex-1" />
        {canRemove && (
          <IconButton title="Remove channel" onClick={onRemove} danger>
            <X size={12} />
          </IconButton>
        )}
      </div>
    </div>
  );
}
