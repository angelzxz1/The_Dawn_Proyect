"use client";

import { useRef, useState } from "react";
import {
  ActivitySquare,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  Download,
  FileAudio,
  Headphones,
  Sliders,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { ValueBar } from "./ValueBar";
import { Meter } from "./Meter";
import { InputMeter } from "./InputMeter";
import type { ChannelConfig } from "@/project/types";
import { TRACK_COLOR_PALETTE, type TrackColor, type TrackColorPick } from "@/project/colors";
import { CustomColorButton } from "./CustomColorButton";
import { TRACK_HEADER_WIDTH, TRACK_ROW_HEIGHT } from "@/studio/timeline/layout";

/** Mute and solo, shared by the full and the folded header. */
function MuteSolo({ channel, onMuteToggle, onSoloToggle }: Pick<TrackHeaderProps, "channel" | "onMuteToggle" | "onSoloToggle">) {
  return (
    <>
      <button
        type="button"
        title={channel.muted ? "Unmute" : "Mute"}
        aria-pressed={channel.muted}
        onClick={(e) => {
          e.stopPropagation();
          onMuteToggle?.();
        }}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${
          channel.muted ? "border-record bg-record/20 text-record" : "border-border text-muted hover:bg-surface-raised"
        }`}
      >
        M
      </button>
      <button
        type="button"
        title={channel.solo ? "Unsolo" : "Solo"}
        aria-pressed={channel.solo}
        onClick={(e) => {
          e.stopPropagation();
          onSoloToggle?.();
        }}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${
          channel.solo ? "border-yellow-400 bg-yellow-400/20 text-yellow-300" : "border-border text-muted hover:bg-surface-raised"
        }`}
      >
        S
      </button>
    </>
  );
}

interface TrackHeaderProps {
  channel: ChannelConfig;
  color: TrackColor;
  selected: boolean;
  recording: boolean;
  hasNotes: boolean;
  /** Whether there's anything to clear - MIDI notes, or an audio clip. */
  hasClipContent?: boolean;
  canRemove: boolean;
  /** The master bus track: no clip, no import/export/clear/remove. */
  isMaster?: boolean;
  effectsCount?: number;
  onSelect: () => void;
  onRename: (name: string) => void;
  onVolumeChange: (db: number) => void;
  onPanChange: (pan: number) => void;
  /** Fired once at the start of a vol/pan drag or edit gesture - lets the
   * caller push one undo checkpoint per gesture. */
  onAdjustStart?: () => void;
  onMuteToggle?: () => void;
  onSoloToggle?: () => void;
  /** Toggles this channel's record-arm - exactly one channel is armed at a
   * time. Only the armed channel is what Record captures and the only one
   * that sounds for incoming notes. */
  onArmToggle?: () => void;
  /** Audio tracks only: whether this track's input is heard live, through
   * its effects (the headphones button). */
  monitoring?: boolean;
  onMonitorToggle?: () => void;
  /** Opens the FX window (instrument slot + effects chain). */
  onOpenFx?: () => void;
  onImportMidi?: (file: File) => void;
  onExportMidi?: () => void;
  onImportAudio?: (file: File) => void;
  onClearClip?: () => void;
  onRemove?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** A palette slot or any color from the color wheel. */
  onRecolor?: (pick: TrackColorPick) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** Whether this track's automation lane is currently expanded below it. */
  showAutomation?: boolean;
  onToggleAutomation?: () => void;
  /** The browser's available audio input devices, and which one this
   * track records from - shown in place of the "Audio" badge on an audio
   * track so a device can be picked right on the track, without needing
   * it armed first. Unused for a MIDI track. */
  inputDevices?: { deviceId: string; label: string }[];
  selectedInputDeviceId?: string | null;
  onInputDeviceChange?: (deviceId: string | null) => void;
  /** Primes mic permission and refreshes `inputDevices` - fired when the
   * input select gains focus, since the browser only returns the full,
   * labeled device list once permission has been granted at least once. */
  onRequestInputDevices?: () => void;
  /** The row's height: short when the track is folded. */
  rowHeight?: number;
  /** Folds or unfolds this track; `all` (Alt-click) does every track. */
  onToggleFold?: (all: boolean) => void;
  /** For a group's member: the group's color, drawn as a bar at its left. */
  groupColor?: TrackColor;
  /** For a group: how many tracks it holds. */
  memberCount?: number;
  /** Ctrl/Cmd-clicked, to be grouped with the other picked tracks. */
  picked?: boolean;
  onPick?: () => void;
  /** Where its audio goes, when that's not the default (another track's
   * name, or "Master" for a member sent past its group). */
  outputName?: string | null;
  /** Audio tracks: the track its input comes from, when that's not the
   * audio interface ("Audio From"). */
  inputName?: string | null;
}

function formatDb(db: number): string {
  return db <= -60 ? "-∞" : `${db.toFixed(1)}dB`;
}

function formatPan(pan: number): string {
  if (Math.abs(pan) < 0.02) return "C";
  return pan < 0 ? `${Math.round(-pan * 100)}L` : `${Math.round(pan * 100)}R`;
}

function instrumentLabel(instrument: ChannelConfig["instrument"]): string {
  if (instrument === "piano") return "Piano";
  if (instrument === "drums") return "Drums";
  if (instrument === "synth") return "Synth";
  return "Empty";
}

function IconButton({
  title,
  onClick,
  disabled,
  danger,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-5 w-5 items-center justify-center rounded border hover:bg-surface-raised disabled:opacity-30 ${
        danger ? "border-border text-record" : active ? "border-accent text-accent" : "border-border text-muted"
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
  effectsCount = 0,
  onSelect,
  onRename,
  onVolumeChange,
  onPanChange,
  onAdjustStart,
  onMuteToggle,
  onSoloToggle,
  onArmToggle,
  monitoring = false,
  onMonitorToggle,
  onOpenFx,
  onImportMidi,
  onExportMidi,
  onImportAudio,
  onClearClip,
  onRemove,
  onContextMenu,
  onRecolor,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  showAutomation,
  onToggleAutomation,
  inputDevices,
  selectedInputDeviceId,
  onInputDeviceChange,
  onRequestInputDevices,
  rowHeight = TRACK_ROW_HEIGHT,
  onToggleFold,
  groupColor,
  memberCount = 0,
  picked = false,
  onPick,
  outputName,
  inputName,
}: TrackHeaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(channel.name);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const isMidi = channel.type === "midi";
  const isGroup = channel.type === "group";
  const folded = rowHeight < TRACK_ROW_HEIGHT;

  const commitRename = () => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== channel.name) onRename(trimmed);
    setEditingName(false);
  };

  return (
    <div
      onClick={(e) => {
        if ((e.ctrlKey || e.metaKey) && onPick) onPick();
        else onSelect();
      }}
      onContextMenu={onContextMenu}
      style={{ width: TRACK_HEADER_WIDTH, height: rowHeight }}
      title={onPick ? "Ctrl/Cmd-click to pick several tracks, then Ctrl+G to group them" : undefined}
      className={`relative flex shrink-0 cursor-pointer flex-col gap-1 border-b border-r border-border py-1.5 pr-1.5 transition-colors ${
        groupColor ? "pl-3" : "pl-1.5"
      } ${folded ? "justify-center" : ""} ${picked ? "ring-2 ring-inset ring-accent" : ""} ${
        picked ? "bg-accent/10" : selected ? "bg-surface-raised" : isGroup ? "bg-surface-raised/40 hover:bg-surface-raised/70" : "bg-surface hover:bg-surface-raised/60"
      }`}
    >
      {groupColor && <div className="pointer-events-none absolute inset-y-0 left-0 w-1.5" style={{ background: groupColor.accent, opacity: 0.7 }} />}
      {isGroup && !folded && <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5" style={{ background: color.accent }} />}
      <div className="relative flex items-center gap-1.5">
        {onToggleFold && (
          <button
            type="button"
            title={`${channel.folded ? "Unfold" : isGroup ? "Fold (hide its tracks)" : "Fold"} · Alt-click: all tracks`}
            aria-expanded={!channel.folded}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFold(e.altKey);
            }}
            className="-mx-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted hover:bg-surface-raised hover:text-foreground"
          >
            {channel.folded ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
        )}
        {isMaster ? (
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: color.accent }}
          />
        ) : (
          <button
            type="button"
            title="Change track color"
            onClick={(e) => {
              e.stopPropagation();
              setShowColorPicker((v) => !v);
            }}
            className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/20"
            style={{ background: color.accent }}
          />
        )}
        {showColorPicker && (
          <>
            <div
              className="fixed inset-0 z-20"
              onClick={(e) => {
                e.stopPropagation();
                setShowColorPicker(false);
              }}
            />
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute left-0 top-4 z-30 flex flex-wrap gap-1 rounded border border-border bg-surface-raised p-1.5 shadow-lg"
              style={{ width: 112 }}
            >
            {TRACK_COLOR_PALETTE.map((swatch, i) => (
              <button
                key={i}
                type="button"
                title={`Color ${i + 1}`}
                onClick={() => {
                  onRecolor?.({ colorIndex: i });
                  setShowColorPicker(false);
                }}
                className="h-4 w-4 rounded-full ring-1 ring-black/30 hover:ring-white/60"
                style={{ background: swatch.accent }}
              />
            ))}
            <CustomColorButton
              value={color.accent}
              onPick={(hex) => {
                onRecolor?.({ color: hex });
                setShowColorPicker(false);
              }}
            />
            </div>
          </>
        )}
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
        {isGroup && !folded && (
          <span title={`${memberCount} track${memberCount === 1 ? "" : "s"} in this group`} className="shrink-0 rounded border border-border px-1 text-[9px] text-muted">
            {memberCount}
          </span>
        )}
        {folded && !isMaster && <MuteSolo channel={channel} onMuteToggle={onMuteToggle} onSoloToggle={onSoloToggle} />}
        {!isMaster && !isMidi && !isGroup && !folded && (
          <button
            type="button"
            title={
              monitoring
                ? "Monitoring - hearing this track's input live through its effects. Click to stop."
                : "Monitor - hear this track's input live through its effects (use headphones)"
            }
            aria-pressed={monitoring}
            onClick={(e) => {
              e.stopPropagation();
              onMonitorToggle?.();
            }}
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
              monitoring ? "border-accent bg-accent/25 text-accent" : "border-border text-muted hover:bg-surface-raised"
            }`}
          >
            <Headphones size={10} />
          </button>
        )}
        {!isMaster && !isGroup && (
          <button
            type="button"
            title={
              channel.armed
                ? "Record-armed - click to disarm"
                : "Arm this channel for recording and note input"
            }
            aria-pressed={channel.armed}
            onClick={(e) => {
              e.stopPropagation();
              onArmToggle?.();
            }}
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
              channel.armed
                ? "animate-pulse-rec border-record bg-record text-white"
                : "border-border text-record hover:bg-surface-raised"
            }`}
          >
            <Circle size={9} fill="currentColor" />
          </button>
        )}
        {recording && (
          <span className="h-2 w-2 shrink-0 animate-pulse-rec rounded-full bg-record" />
        )}
      </div>

      {!folded && (
      <div
        className="flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-1.5">
          <ValueBar
            label="Pan"
            value={channel.pan}
            min={-1}
            max={1}
            defaultValue={0}
            onChange={onPanChange}
            onDragStart={onAdjustStart}
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
            onDragStart={onAdjustStart}
            formatValue={formatDb}
          />
        </div>
        <div className="h-[26px]">
          <Meter channelId={isMaster ? "master" : channel.id} />
        </div>
      </div>
      )}

      {!isMaster && !folded && (
        <div
          className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          {isGroup ? (
            <span title="Group track: its tracks play through it, so its effects, fader, mute and solo act on all of them" className="flex h-5 items-center rounded border border-border px-1.5 text-[10px] text-muted">
              Group
            </span>
          ) : isMidi ? (
            <span
              title="MIDI track"
              className={`flex h-5 items-center rounded border px-1.5 text-[10px] ${
                channel.instrument === null ? "border-record/50 text-record" : "border-border text-muted"
              }`}
            >
              {instrumentLabel(channel.instrument)}
            </span>
          ) : inputName ? (
            <span
              title={`Input: ${inputName}. Change it in the track's FX rack (Audio from).`}
              className="flex h-5 max-w-[76px] items-center truncate rounded border border-accent/40 px-1.5 text-[10px] text-accent"
            >
              ← {inputName.split(" · ")[0]}
            </span>
          ) : (
            <select
              title="Which microphone or audio-interface input this track records from"
              value={selectedInputDeviceId ?? ""}
              onChange={(e) => onInputDeviceChange?.(e.target.value || null)}
              onFocus={() => onRequestInputDevices?.()}
              className="h-5 max-w-[76px] rounded border border-border bg-surface px-1 text-[10px] text-muted"
            >
              <option value="">Default</option>
              {(inputDevices ?? []).map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          )}
          <div className="min-w-0 flex-1 truncate text-[9.5px] text-muted" title={outputName ? `Audio to ${outputName}` : undefined}>
            {outputName ? `→ ${outputName}` : ""}
          </div>
          <MuteSolo channel={channel} onMuteToggle={onMuteToggle} onSoloToggle={onSoloToggle} />
          <button
            type="button"
            title={`FX${effectsCount > 0 ? ` (${effectsCount})` : ""} — instrument & effects`}
            onClick={() => onOpenFx?.()}
            className={`relative flex h-5 items-center gap-1 rounded border border-border px-1.5 text-[10px] font-medium hover:bg-surface-raised ${
              effectsCount > 0 ? "text-accent" : "text-muted"
            }`}
          >
            <Sliders size={11} />
            FX
            {effectsCount > 0 && (
              <span className="flex h-3 w-3 items-center justify-center rounded-full bg-accent text-[7px] font-bold text-black">
                {effectsCount}
              </span>
            )}
          </button>
        </div>
      )}

      {!isMaster && !folded && (
        <div
          className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          {isGroup ? null : isMidi ? (
            <>
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
                disabled={!hasNotes}
              >
                <Download size={12} />
              </IconButton>
            </>
          ) : (
            <>
              <IconButton title="Import audio file" onClick={() => audioInputRef.current?.click()}>
                <FileAudio size={12} />
              </IconButton>
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onImportAudio?.(file);
                  e.target.value = "";
                }}
              />
            </>
          )}
          {!isGroup && (
            <IconButton
              title="Clear all clips on this track"
              onClick={() => onClearClip?.()}
              disabled={!(hasClipContent ?? hasNotes)}
            >
              <Trash2 size={12} />
            </IconButton>
          )}
          <IconButton title="Move track up" onClick={() => onMoveUp?.()} disabled={!canMoveUp}>
            <ChevronUp size={12} />
          </IconButton>
          <IconButton title="Move track down" onClick={() => onMoveDown?.()} disabled={!canMoveDown}>
            <ChevronDown size={12} />
          </IconButton>
          {onToggleAutomation && (
            <IconButton
              title={showAutomation ? "Hide automation lane" : "Show automation lane"}
              onClick={() => onToggleAutomation()}
              active={showAutomation}
            >
              <ActivitySquare size={12} />
            </IconButton>
          )}
          {!isMidi && !isGroup && !inputName && channel.armed ? <InputMeter /> : <div className="flex-1" />}
          {canRemove && (
            <IconButton title={isGroup ? "Remove the group (its tracks stay)" : "Remove channel"} onClick={() => onRemove?.()} danger>
              <X size={12} />
            </IconButton>
          )}
        </div>
      )}
    </div>
  );
}
