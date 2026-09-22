"use client";

import { useState } from "react";
import { Drum, Piano, Power, SlashSquare, Waves, X } from "lucide-react";
import { ValueBar } from "./ValueBar";
import { EFFECT_DRAG_MIME } from "./EffectBrowser";
import { EFFECT_LABELS, paramSpecs, type EffectInstance, type EffectType } from "@/lib/effects";
import { SYNTH_PRESETS } from "@/lib/synth";
import type { BusConfig, ChannelType, InstrumentType, SynthParams } from "@/lib/types";
import type { TrackColor } from "@/lib/colors";

interface FxRackProps {
  channelName: string;
  /** Omitted for a bus's rack - buses have no instrument slot and can't
   * themselves send to another bus (keeps the send graph acyclic). */
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
  /** `atIndex` omitted means "append at the end". */
  onAddEffect: (type: EffectType, atIndex?: number) => void;
  onRemoveEffect: (effectId: string) => void;
  onMoveEffect: (effectId: string, toIndex: number) => void;
  onBypassToggle: (effectId: string) => void;
  onParamChange: (effectId: string, key: string, value: number) => void;
  /** Fired once at the start of a param drag/edit gesture - lets the caller
   * push one undo checkpoint per gesture. */
  onParamDragStart?: () => void;
}

const REORDER_DRAG_MIME = "application/x-dawn-effect-reorder";

const INSTRUMENT_OPTIONS: { type: InstrumentType | null; label: string; icon: React.ReactNode }[] = [
  { type: null, label: "None", icon: <SlashSquare size={12} /> },
  { type: "piano", label: "Piano", icon: <Piano size={12} /> },
  { type: "drums", label: "Drums", icon: <Drum size={12} /> },
  { type: "synth", label: "Synth", icon: <Waves size={12} /> },
];

const SEND_OFF_DB = -60;
const SEND_MIN_DB = -60;

/** A narrow drop target sitting between (or at either end of) the device
 * cards - dropping an effect (from the sidebar, or reordering an existing
 * one) here inserts it at exactly this position in the chain. Highlights
 * while something's dragged over it, like Ableton's insertion marker. */
function DropGap({
  index,
  active,
  onDragOverGap,
  onDropAt,
}: {
  index: number;
  active: boolean;
  onDragOverGap: (index: number | null) => void;
  onDropAt: (index: number, e: React.DragEvent) => void;
}) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        onDragOverGap(index);
      }}
      onDragLeave={() => onDragOverGap(null)}
      onDrop={(e) => {
        e.preventDefault();
        onDropAt(index, e);
      }}
      className="relative w-2 shrink-0 self-stretch"
    >
      {active && <div className="absolute inset-y-1 left-1/2 w-0.5 -translate-x-1/2 rounded bg-accent" />}
    </div>
  );
}

/**
 * An Ableton-style device chain, docked to the bottom of the screen: for a
 * MIDI track, an instrument card first (which can be left empty, or loaded
 * with the synth's own sound-design panel), then an ordered row of
 * individually-bypassable effect cards - audio tracks and buses only get
 * the effects row. Drop a device from the EffectBrowser sidebar anywhere
 * in the row to add it there; drag an existing card to reorder it. A track
 * (not a bus) also gets a trailing Sends card, one level per existing bus.
 */
export function FxRack({
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
  onAddEffect,
  onRemoveEffect,
  onMoveEffect,
  onBypassToggle,
  onParamChange,
  onParamDragStart,
}: FxRackProps) {
  const [dragOverGap, setDragOverGap] = useState<number | null>(null);
  const isBus = channelType === undefined;

  const handleDropAt = (index: number, e: React.DragEvent) => {
    setDragOverGap(null);
    const newType = e.dataTransfer.getData(EFFECT_DRAG_MIME) as EffectType | "";
    const reorderId = e.dataTransfer.getData(REORDER_DRAG_MIME);
    if (newType) onAddEffect(newType, index);
    else if (reorderId) onMoveEffect(reorderId, index);
  };

  return (
    <div className="flex h-[260px] shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border bg-surface-raised px-3 py-1.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color.accent }} />
        <span className="text-xs font-medium">FX — {channelName}</span>
        <span className="text-[10px] text-muted">
          drag a device from the sidebar into the rack, or drag a card to reorder it
        </span>
      </div>

      <div className="flex flex-1 items-stretch gap-0 overflow-x-auto p-2">
        {channelType === "midi" && (
          <div className="flex w-64 shrink-0 flex-col rounded border border-border bg-surface-raised p-2">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Instrument
            </div>
            <div className="mb-1.5 flex overflow-hidden rounded border border-border">
              {INSTRUMENT_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => onInstrumentChange?.(opt.type)}
                  className={`flex flex-1 items-center justify-center gap-1 border-l border-border py-1.5 text-[11px] first:border-l-0 ${
                    instrument === opt.type
                      ? "bg-accent/25 text-accent"
                      : "text-muted hover:bg-surface"
                  }`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
            {instrument === null && (
              <p className="text-[11px] text-muted">No instrument loaded — this track stays silent.</p>
            )}
            {instrument === "synth" && synthParams && onSynthParamsChange && (
              <SynthPanel params={synthParams} onChange={onSynthParamsChange} onDragStart={onParamDragStart} />
            )}
          </div>
        )}

        <DropGap index={0} active={dragOverGap === 0} onDragOverGap={setDragOverGap} onDropAt={handleDropAt} />

        {effects.map((fx, i) => (
          <div key={fx.id} className="flex items-stretch">
            <div
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(REORDER_DRAG_MIME, fx.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              className={`flex w-44 shrink-0 cursor-grab flex-col rounded border border-border bg-surface-raised p-2 active:cursor-grabbing ${
                fx.bypass ? "opacity-50" : ""
              }`}
            >
              <div className="mb-1.5 flex items-center justify-between">
                <span className="truncate text-[11px] font-semibold">{EFFECT_LABELS[fx.type]}</span>
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
                    title="Remove effect"
                    onClick={() => onRemoveEffect(fx.id)}
                    className="flex h-5 w-5 items-center justify-center rounded text-record hover:bg-surface"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
              <div className="flex flex-1 flex-wrap content-start gap-2">
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
            <DropGap
              index={i + 1}
              active={dragOverGap === i + 1}
              onDragOverGap={setDragOverGap}
              onDropAt={handleDropAt}
            />
          </div>
        ))}

        {effects.length === 0 && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleDropAt(0, e)}
            className="flex w-56 shrink-0 items-center justify-center rounded border border-dashed border-border text-[11px] text-muted"
          >
            Drag effects here
          </div>
        )}

        {!isBus && buses.length > 0 && onSendChange && (
          <div className="flex w-44 shrink-0 flex-col rounded border border-border bg-surface-raised p-2">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Sends
            </div>
            <div className="flex flex-1 flex-wrap content-start gap-2">
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
    <div className="flex flex-1 flex-col overflow-y-auto">
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

      <div className="flex flex-1 flex-wrap content-start gap-2">
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
