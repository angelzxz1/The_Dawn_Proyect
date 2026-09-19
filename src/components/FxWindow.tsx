"use client";

import { useEffect } from "react";
import { ChevronDown, ChevronUp, Drum, Piano, Plus, SlashSquare, X } from "lucide-react";
import { ValueBar } from "./ValueBar";
import {
  EFFECT_LABELS,
  EFFECT_TYPES,
  paramSpecs,
  type EffectInstance,
  type EffectType,
} from "@/lib/effects";
import type { ChannelType, InstrumentType } from "@/lib/types";
import type { TrackColor } from "@/lib/colors";

interface FxWindowProps {
  channelName: string;
  channelType: ChannelType;
  color: TrackColor;
  instrument: InstrumentType | null;
  effects: EffectInstance[];
  onInstrumentChange: (type: InstrumentType | null) => void;
  onAdd: (type: EffectType) => void;
  onRemove: (effectId: string) => void;
  onReorder: (effectId: string, direction: -1 | 1) => void;
  onParamChange: (effectId: string, key: string, value: number) => void;
  /** Fired once at the start of a param drag/edit gesture - lets the caller
   * push one undo checkpoint per gesture. */
  onParamDragStart?: () => void;
  onClose: () => void;
}

const INSTRUMENT_OPTIONS: { type: InstrumentType | null; label: string; icon: React.ReactNode }[] = [
  { type: null, label: "None", icon: <SlashSquare size={13} /> },
  { type: "piano", label: "Piano", icon: <Piano size={13} /> },
  { type: "drums", label: "Drums", icon: <Drum size={13} /> },
];

/**
 * A Reaper-style FX chain window for one track: for a MIDI track, an
 * instrument slot (which can be left empty) at the top of the chain, then
 * an ordered rack of audio effects underneath - audio tracks only get the
 * effects rack, since they have no instrument to load.
 */
export function FxWindow({
  channelName,
  channelType,
  color,
  instrument,
  effects,
  onInstrumentChange,
  onAdd,
  onRemove,
  onReorder,
  onParamChange,
  onParamDragStart,
  onClose,
}: FxWindowProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[85vh] w-[420px] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-raised px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: color.accent }} />
            <span className="text-sm font-medium">FX — {channelName}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="flex h-6 w-6 items-center justify-center rounded border border-border text-muted hover:bg-surface"
          >
            <X size={13} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {channelType === "midi" && (
            <div className="mb-4">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Instrument
              </div>
              <div className="flex overflow-hidden rounded border border-border">
                {INSTRUMENT_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => onInstrumentChange(opt.type)}
                    className={`flex flex-1 items-center justify-center gap-1.5 border-l border-border py-1.5 text-xs first:border-l-0 ${
                      instrument === opt.type
                        ? "bg-accent/25 text-accent"
                        : "text-muted hover:bg-surface-raised"
                    }`}
                  >
                    {opt.icon}
                    {opt.label}
                  </button>
                ))}
              </div>
              {instrument === null && (
                <p className="mt-1.5 text-[11px] text-muted">
                  No instrument loaded — this track will stay silent until you pick one.
                </p>
              )}
            </div>
          )}

          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
            Audio effects
          </div>
          {effects.length === 0 && (
            <p className="mb-2 text-[11px] text-muted">No effects yet — add one below.</p>
          )}
          <div className="flex flex-col gap-2">
            {effects.map((fx, i) => (
              <div key={fx.id} className="rounded border border-border bg-surface-raised p-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold">{EFFECT_LABELS[fx.type]}</span>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      title="Move earlier in the chain"
                      disabled={i === 0}
                      onClick={() => onReorder(fx.id, -1)}
                      className="flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-surface disabled:opacity-25"
                    >
                      <ChevronUp size={12} />
                    </button>
                    <button
                      type="button"
                      title="Move later in the chain"
                      disabled={i === effects.length - 1}
                      onClick={() => onReorder(fx.id, 1)}
                      className="flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-surface disabled:opacity-25"
                    >
                      <ChevronDown size={12} />
                    </button>
                    <button
                      type="button"
                      title="Remove effect"
                      onClick={() => onRemove(fx.id)}
                      className="flex h-5 w-5 items-center justify-center rounded text-record hover:bg-surface"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {paramSpecs(fx.type).map((spec) => (
                    <ValueBar
                      key={spec.key}
                      label={spec.label}
                      value={fx.params[spec.key]}
                      min={spec.min}
                      max={spec.max}
                      defaultValue={spec.default}
                      onChange={(v) => onParamChange(fx.id, spec.key, v)}
                      onDragStart={onParamDragStart}
                      formatValue={spec.format}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 border-t border-border pt-2">
            <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted">
              <Plus size={11} /> Add effect
            </div>
            <div className="grid grid-cols-2 gap-1">
              {EFFECT_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => onAdd(type)}
                  className="rounded border border-border px-2 py-1 text-[11px] text-foreground hover:border-accent hover:text-accent"
                >
                  {EFFECT_LABELS[type]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
