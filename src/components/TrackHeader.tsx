"use client";

import { useRef, useState } from "react";
import { Download, Drum, Mic, Pencil, Piano, Sliders, Trash2, Upload, X } from "lucide-react";
import { ValueBar } from "./ValueBar";
import { Meter } from "./Meter";
import type { ChannelConfig, ClipType, InstrumentType } from "@/lib/types";
import type { TrackColor } from "@/lib/colors";
import { TRACK_HEADER_WIDTH, TRACK_ROW_HEIGHT } from "@/lib/timeline";

interface TrackHeaderProps {
  channel: ChannelConfig;
  color: TrackColor;
  selected: boolean;
  recording: boolean;
  hasNotes: boolean;
  /** Whether there's anything to clear - MIDI notes, or an audio clip. */
  hasClipContent?: boolean;
  canRemove: boolean;
  /** The master bus track: no MIDI clip, no import/export/clear/remove. */
  isMaster?: boolean;
  /** What this track's single clip currently holds - a MIDI instrument
   * selector only makes sense while it's a MIDI clip. */
  clipType?: ClipType;
  effectsCount?: number;
  /** What hitting the transport's Record button will capture onto this
   * track - MIDI played on the keyboard/pads, or live microphone input. */
  recordMode?: "midi" | "audio";
  onSelect: () => void;
  onEdit?: () => void;
  onRename: (name: string) => void;
  onVolumeChange: (db: number) => void;
  onPanChange: (pan: number) => void;
  onInstrumentChange?: (type: InstrumentType) => void;
  onRecordModeChange?: (mode: "midi" | "audio") => void;
  onOpenEffects?: (e: React.MouseEvent) => void;
  onImportMidi?: (file: File) => void;
  onExportMidi?: () => void;
  onClearClip?: () => void;
  onRemove?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
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
  hasClipContent,
  canRemove,
  isMaster = false,
  clipType = "midi",
  effectsCount = 0,
  recordMode = "midi",
  onSelect,
  onEdit,
  onRename,
  onVolumeChange,
  onPanChange,
  onInstrumentChange,
  onRecordModeChange,
  onOpenEffects,
  onImportMidi,
  onExportMidi,
  onClearClip,
  onRemove,
  onContextMenu,
}: TrackHeaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(channel.name);

  const commitRename = () => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== channel.name) onRename(trimmed);
    setEditingName(false);
  };

  return (
    <div
      onClick={onSelect}
      onContextMenu={onContextMenu}
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
        {editingName ? (
          <input
            autoFocus
            value={draftName}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setDraftName(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              else if (e.key === "Escape") {
                setDraftName(channel.name);
                setEditingName(false);
              }
            }}
            className="min-w-0 flex-1 rounded border border-accent bg-surface px-1 text-sm font-medium outline-none"
          />
        ) : (
          <span
            title="Double-click to rename"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setDraftName(channel.name);
              setEditingName(true);
            }}
            className="min-w-0 flex-1 truncate text-sm font-medium"
          >
            {channel.name}
          </span>
        )}
        {recording && (
          <span className="h-2 w-2 shrink-0 animate-pulse-rec rounded-full bg-record" />
        )}
        {!isMaster && onEdit && (
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
        )}
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
          <Meter channelId={isMaster ? "master" : channel.id} />
        </div>
      </div>

      {!isMaster && (
        <div
          className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          {clipType === "midi" ? (
            <div className="flex overflow-hidden rounded border border-border">
              <button
                type="button"
                title="Piano"
                onClick={() => onInstrumentChange?.("piano")}
                className={`flex h-6 w-6 items-center justify-center ${
                  channel.instrument === "piano"
                    ? "bg-accent/25 text-accent"
                    : "text-muted hover:bg-surface-raised"
                }`}
              >
                <Piano size={12} />
              </button>
              <button
                type="button"
                title="Drums"
                onClick={() => onInstrumentChange?.("drums")}
                className={`flex h-6 w-6 items-center justify-center border-l border-border ${
                  channel.instrument === "drums"
                    ? "bg-accent/25 text-accent"
                    : "text-muted hover:bg-surface-raised"
                }`}
              >
                <Drum size={12} />
              </button>
            </div>
          ) : (
            <span className="flex h-6 items-center rounded border border-border px-1.5 text-[10px] text-muted">
              Audio
            </span>
          )}
          <button
            type="button"
            title={
              recordMode === "audio"
                ? "Recording will capture microphone input - click to record MIDI instead"
                : "Recording will capture MIDI - click to record microphone input instead"
            }
            onClick={() =>
              onRecordModeChange?.(recordMode === "audio" ? "midi" : "audio")
            }
            className={`flex h-6 w-6 items-center justify-center rounded border ${
              recordMode === "audio"
                ? "border-record bg-record/20 text-record"
                : "border-border text-muted hover:bg-surface-raised"
            }`}
          >
            <Mic size={12} />
          </button>
          <button
            type="button"
            title={`Effects${effectsCount > 0 ? ` (${effectsCount})` : ""}`}
            onClick={(e) => onOpenEffects?.(e)}
            className={`relative flex h-6 w-6 items-center justify-center rounded border border-border hover:bg-surface-raised ${
              effectsCount > 0 ? "text-accent" : "text-muted"
            }`}
          >
            <Sliders size={12} />
            {effectsCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-3 w-3 items-center justify-center rounded-full bg-accent text-[7px] font-bold text-black">
                {effectsCount}
              </span>
            )}
          </button>
          <div className="flex-1" />
        </div>
      )}

      {!isMaster && (
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
              if (file) onImportMidi?.(file);
              e.target.value = "";
            }}
          />
          <IconButton
            title="Export .mid"
            onClick={() => onExportMidi?.()}
            disabled={clipType === "audio" || !hasNotes}
          >
            <Download size={12} />
          </IconButton>
          <IconButton
            title="Clear clip"
            onClick={() => onClearClip?.()}
            disabled={!(hasClipContent ?? hasNotes)}
          >
            <Trash2 size={12} />
          </IconButton>
          <div className="flex-1" />
          {canRemove && (
            <IconButton title="Remove channel" onClick={() => onRemove?.()} danger>
              <X size={12} />
            </IconButton>
          )}
        </div>
      )}
    </div>
  );
}
