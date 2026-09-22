"use client";

import { useEffect } from "react";
import {
  ChevronDown,
  ChevronUp,
  Drum,
  Piano,
  Plus,
  Power,
  SlashSquare,
  Waves,
  X,
} from "lucide-react";
import { ValueBar } from "./ValueBar";
import {
  EFFECT_LABELS,
  EFFECT_TYPES,
  paramSpecs,
  type EffectInstance,
  type EffectType,
} from "@/lib/effects";
import { SYNTH_PRESETS } from "@/lib/synth";
import type { BusConfig, ChannelType, InstrumentType, SynthParams } from "@/lib/types";
import type { TrackColor } from "@/lib/colors";

interface FxWindowProps {
  channelName: string;
  /** Omitted for a bus's FX window - buses have no instrument slot and
   * can't themselves send to another bus (keeps the send graph acyclic). */
  channelType?: ChannelType;
  color: TrackColor;
  instrument?: InstrumentType | null;
  synthParams?: SynthParams;
  effects: EffectInstance[];
  buses?: BusConfig[];
  sends?: Record<string, number>;
  onInstrumentChange?: (type: InstrumentType | null) => void;
  onSynthParamsChange?: (params: SynthParams) => void;
  onSendChange?: (busId: string, db: number | null) => void;
  onAdd: (type: EffectType) => void;
  onRemove: (effectId: string) => void;
  onReorder: (effectId: string, direction: -1 | 1) => void;
  onBypassToggle: (effectId: string) => void;
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
  { type: "synth", label: "Synth", icon: <Waves size={13} /> },
];

const SEND_OFF_DB = -60;
const SEND_MIN_DB = -60;

/**
 * A Reaper-style FX chain window: for a MIDI track, an instrument slot
 * (which can be left empty, or loaded with the synth's own sound-design
 * panel) at the top, then an ordered, individually-bypassable rack of audio
 * effects - audio tracks and buses only get the effects rack. A track (not
 * a bus) also gets a Sends section, one level per existing bus.
 */
export function FxWindow({
  channelName,
  channelType,
  color,
  instrument,
  synthParams,
  effects,
  buses = [],
  sends = {},
  onInstrumentChange,
  onSynthParamsChange,
  onSendChange,
  onAdd,
  onRemove,
  onReorder,
  onBypassToggle,
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

  const isBus = channelType === undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[85vh] w-[440px] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
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
                    onClick={() => onInstrumentChange?.(opt.type)}
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
              {instrument === "synth" && synthParams && onSynthParamsChange && (
                <SynthPanel
                  params={synthParams}
                  onChange={onSynthParamsChange}
                  onDragStart={onParamDragStart}
                />
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
              <div
                key={fx.id}
                className={`rounded border border-border bg-surface-raised p-2 ${
                  fx.bypass ? "opacity-50" : ""
                }`}
              >
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold">{EFFECT_LABELS[fx.type]}</span>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      title={fx.bypass ? "Enable effect" : "Bypass effect"}
                      onClick={() => onBypassToggle(fx.id)}
                      className={`flex h-5 w-5 items-center justify-center rounded hover:bg-surface ${
                        fx.bypass ? "text-muted" : "text-accent"
                      }`}
                    >
                      <Power size={12} />
                    </button>
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

          {!isBus && buses.length > 0 && onSendChange && (
            <div className="mt-3 border-t border-border pt-2">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Sends
              </div>
              <div className="flex flex-wrap gap-2">
                {buses.map((bus) => (
                  <ValueBar
                    key={bus.id}
                    label={bus.name}
                    value={sends[bus.id] ?? SEND_OFF_DB}
                    min={SEND_MIN_DB}
                    max={0}
                    defaultValue={SEND_OFF_DB}
                    onChange={(v) => onSendChange(bus.id, v <= SEND_MIN_DB ? null : v)}
                    onDragStart={onParamDragStart}
                    formatValue={(v) => (v <= SEND_MIN_DB ? "off" : `${v.toFixed(1)}dB`)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const OSCILLATOR_TYPES: SynthParams["oscillatorType"][] = ["sine", "triangle", "sawtooth", "square"];

function SynthPanel({
  params,
  onChange,
  onDragStart,
}: {
  params: SynthParams;
  onChange: (params: SynthParams) => void;
  onDragStart?: () => void;
}) {
  return (
    <div className="mt-2 rounded border border-border bg-surface-raised p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <select
          value=""
          onChange={(e) => {
            const preset = SYNTH_PRESETS.find((p) => p.name === e.target.value);
            if (preset) {
              onDragStart?.();
              onChange({ ...preset.params });
            }
          }}
          className="rounded border border-border bg-surface px-1.5 py-1 text-[11px]"
          title="Load a preset"
        >
          <option value="" disabled>
            Presets…
          </option>
          {SYNTH_PRESETS.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="flex overflow-hidden rounded border border-border">
          {(["subtractive", "fm"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                onDragStart?.();
                onChange({ ...params, mode });
              }}
              className={`px-2 py-1 text-[11px] first:border-r first:border-border ${
                params.mode === mode ? "bg-accent/25 text-accent" : "text-muted hover:bg-surface"
              }`}
            >
              {mode === "subtractive" ? "Subtractive" : "FM"}
            </button>
          ))}
        </div>
      </div>

      {params.mode === "subtractive" ? (
        <div className="mb-1.5 flex overflow-hidden rounded border border-border">
          {OSCILLATOR_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                onDragStart?.();
                onChange({ ...params, oscillatorType: type });
              }}
              className={`flex-1 border-l border-border py-1 text-[11px] capitalize first:border-l-0 ${
                params.oscillatorType === type
                  ? "bg-accent/25 text-accent"
                  : "text-muted hover:bg-surface"
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <ValueBar
          label="Attack"
          value={params.attack}
          min={0.001}
          max={2}
          defaultValue={0.01}
          onChange={(v) => onChange({ ...params, attack: v })}
          onDragStart={onDragStart}
          formatValue={(v) => `${Math.round(v * 1000)}ms`}
        />
        <ValueBar
          label="Decay"
          value={params.decay}
          min={0.01}
          max={2}
          defaultValue={0.2}
          onChange={(v) => onChange({ ...params, decay: v })}
          onDragStart={onDragStart}
          formatValue={(v) => `${Math.round(v * 1000)}ms`}
        />
        <ValueBar
          label="Sustain"
          value={params.sustain}
          min={0}
          max={1}
          defaultValue={0.5}
          onChange={(v) => onChange({ ...params, sustain: v })}
          onDragStart={onDragStart}
          formatValue={(v) => `${Math.round(v * 100)}%`}
        />
        <ValueBar
          label="Release"
          value={params.release}
          min={0.01}
          max={3}
          defaultValue={0.2}
          onChange={(v) => onChange({ ...params, release: v })}
          onDragStart={onDragStart}
          formatValue={(v) => `${v.toFixed(2)}s`}
        />
        {params.mode === "subtractive" ? (
          <>
            <ValueBar
              label="Cutoff"
              value={params.filterCutoff}
              min={40}
              max={12000}
              defaultValue={2000}
              onChange={(v) => onChange({ ...params, filterCutoff: v })}
              onDragStart={onDragStart}
              formatValue={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}Hz`)}
            />
            <ValueBar
              label="Reso"
              value={params.filterResonance}
              min={0.1}
              max={20}
              defaultValue={1}
              onChange={(v) => onChange({ ...params, filterResonance: v })}
              onDragStart={onDragStart}
              formatValue={(v) => v.toFixed(1)}
            />
          </>
        ) : (
          <>
            <ValueBar
              label="Harmon."
              value={params.harmonicity}
              min={0.5}
              max={8}
              defaultValue={2}
              onChange={(v) => onChange({ ...params, harmonicity: v })}
              onDragStart={onDragStart}
              formatValue={(v) => v.toFixed(1)}
            />
            <ValueBar
              label="Mod idx"
              value={params.modulationIndex}
              min={0}
              max={40}
              defaultValue={8}
              onChange={(v) => onChange({ ...params, modulationIndex: v })}
              onDragStart={onDragStart}
              formatValue={(v) => v.toFixed(0)}
            />
          </>
        )}
      </div>
    </div>
  );
}
