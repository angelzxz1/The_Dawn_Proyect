"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Drum, GripVertical, Piano, Power, SlashSquare, Waves, X } from "lucide-react";
import { ValueBar } from "@/studio/tracks/ValueBar";
import { EQThreeRackCard } from "@/effects/eq-three/EQThreeRackCard";
import { CompressorRackCard } from "@/effects/compressor/CompressorRackCard";
import { DelayRackCard } from "@/effects/delay/DelayRackCard";
import { ReverbRackCard } from "@/effects/reverb/ReverbRackCard";
import { LimiterRackCard } from "@/effects/limiter/LimiterRackCard";
import { FilterRackCard } from "@/effects/filter/FilterRackCard";
import { ChorusRackCard } from "@/effects/chorus/ChorusRackCard";
import { PitchShiftRackCard } from "@/effects/pitch-shift/PitchShiftRackCard";
import { SaturatorRackCard } from "@/effects/saturator/SaturatorRackCard";
import { IrLoaderRackCard } from "@/effects/ir-loader/IrLoaderRackCard";
import { NamAmpRackCard } from "@/effects/nam-amp/NamAmpRackCard";
import { GateRackCard } from "@/effects/gate/GateRackCard";
import { ParamEqRackCard } from "@/effects/parametric-eq/ParamEqRackCard";
import { MultibandRackCard } from "@/effects/multiband/MultibandRackCard";
import { UtilityRackCard } from "@/effects/utility/UtilityRackCard";
import { TunerRackCard } from "@/effects/tuner/TunerRackCard";
import { GlueRackCard } from "@/effects/glue/GlueRackCard";
import { FurnaceRackCard } from "@/effects/furnace/FurnaceRackCard";
import { MbDynamicsRackCard } from "@/effects/multiband-dynamics/MbDynamicsRackCard";
import { EFFECT_DRAG_MIME, PRESET_DRAG_MIME } from "./EffectBrowser";
import { PresetMenu, type PresetChange } from "@/effects/ui/PresetMenu";
import { sidechainSourceName, type SidechainSource } from "@/effects/sidechain/SidechainPanel";
import { SIDECHAIN_TAPS, SIDECHAIN_TAP_LABELS, type SidechainTap } from "@/effects/sidechain/sidechainModel";
import { EFFECT_LABELS, paramSpecs, type EffectInstance, type EffectType } from "@/effects/registry";
import { SynthRackCard } from "@/instruments/synth/SynthRackCard";
import { DrumRackCard } from "@/instruments/drum-rack/DrumRackCard";
import type { DrumKitParams } from "@/instruments/drum-rack/drumParams";
import type { BusConfig, ChannelType, InstrumentType, SynthParams } from "@/lib/types";
import type { TrackColor } from "@/lib/colors";

interface FxRackProps {
  channelName: string;
  /** The engine id of the channel/bus/master whose effects these are - for
   * cards that show live readings (the Multiband's gain). */
  hostId?: string;
  /** Omitted for a bus's rack - buses have no instrument slot and can't
   * themselves send to another bus (keeps the send graph acyclic). */
  channelType?: ChannelType;
  color: TrackColor;
  instrument?: InstrumentType | null;
  synthParams?: SynthParams;
  /** The Drum Rack's kit, while `instrument === "drums"`. */
  drumParams?: DrumKitParams;
  effects: EffectInstance[];
  /** The project's current tempo - only used by the Delay card/window's
   * Sync mode (note-division knobs) and its "@ N BPM" readout. */
  bpm: number;
  buses?: BusConfig[];
  sends?: Record<string, number>;
  onInstrumentChange?: (type: InstrumentType | null) => void;
  /** Opens the dedicated Synth Settings window - only meaningful while
   * `instrument === "synth"`. */
  onOpenSynthSettings?: () => void;
  /** Macro knobs on the synth's card. */
  onSynthParamsChange?: (params: SynthParams) => void;
  onOpenDrumRack?: () => void;
  onSendChange?: (busId: string, db: number | null) => void;
  /** `atIndex` omitted means "append at the end"; `presetId` loads that
   * preset into the new effect. */
  onAddEffect: (type: EffectType, atIndex?: number, presetId?: string) => void;
  onRemoveEffect: (effectId: string) => void;
  onMoveEffect: (effectId: string, toIndex: number) => void;
  onBypassToggle: (effectId: string) => void;
  onParamChange: (effectId: string, key: string, value: number) => void;
  /** Fired once at the start of a param drag/edit gesture - lets the caller
   * push one undo checkpoint per gesture. */
  onParamDragStart?: () => void;
  /** Opens the full plugin window (EQ Three, Compressor, ...) for one
   * effect instance that has a custom UI. */
  onOpenEffectWindow?: (effectId: string) => void;
  /** Loads an uploaded file (an IR) into a file-based effect; resolves with
   * an error message if the file can't be used. */
  onLoadEffectFile?: (effectId: string, file: File) => Promise<string | null>;
  onClearEffectFile?: (effectId: string) => void;
  /** Loads, saves or resets an effect's preset (see PresetMenu). */
  onPresetChange?: (effectId: string, change: PresetChange) => void;
  /** Tracks and buses, for naming a dynamics effect's sidechain source. */
  sidechainSources?: SidechainSource[];
  /** A track's "Audio to" choices ("" is the default: its group, or the
   * master) and the current one. Omitted for buses and the master. */
  /** An audio track's "Audio From" choices ("" is the audio interface),
   * the current source and where on it the audio is taken. */
  inputOptions?: { value: string; label: string }[];
  inputValue?: string;
  inputTap?: SidechainTap;
  onInputChange?: (track: string, tap: SidechainTap) => void;
  outputOptions?: { value: string; label: string }[];
  outputValue?: string;
  onOutputChange?: (value: string) => void;
}

/** Effect types with a custom rack card + full window, instead of the
 * generic ValueBar-driven card. */
const CUSTOM_UI_TYPES: EffectType[] = [
  "eq3",
  "compressor",
  "delay",
  "reverb",
  "limiter",
  "filter",
  "chorus",
  "pitchShift",
  "distortion",
  "irLoader",
  "namAmp",
  "tubeAmp",
  "gate",
  "paramEq",
  "multiband",
  "utility",
  "tuner",
  "glue",
  "mbDynamics",
];

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
  hostId,
  channelType,
  color,
  instrument,
  synthParams,
  drumParams,
  effects,
  bpm,
  buses = [],
  sends = {},
  onInstrumentChange,
  onOpenSynthSettings,
  onSynthParamsChange,
  onOpenDrumRack,
  onSendChange,
  onAddEffect,
  onRemoveEffect,
  onMoveEffect,
  onBypassToggle,
  onParamChange,
  onParamDragStart,
  onOpenEffectWindow,
  onLoadEffectFile,
  onClearEffectFile,
  sidechainSources,
  onPresetChange,
  inputOptions,
  inputValue = "",
  inputTap = "postFx",
  onInputChange,
  outputOptions,
  outputValue = "",
  onOutputChange,
}: FxRackProps) {
  const [dragOverGap, setDragOverGap] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const isBus = channelType === undefined;

  const handleDropAt = (index: number, e: React.DragEvent) => {
    setDragOverGap(null);
    const newType = e.dataTransfer.getData(EFFECT_DRAG_MIME) as EffectType | "";
    const reorderId = e.dataTransfer.getData(REORDER_DRAG_MIME);
    const presetId = e.dataTransfer.getData(PRESET_DRAG_MIME);
    if (newType) onAddEffect(newType, index, presetId || undefined);
    else if (reorderId) onMoveEffect(reorderId, index);
  };

  return (
    <div
      className={`flex shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-surface ${
        collapsed ? "" : "h-[256px]"
      }`}
    >
      <div className="flex items-center border-b border-border bg-surface-raised">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Expand the FX rack" : "Collapse the FX rack"}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left"
        >
          {collapsed ? <ChevronUp size={12} className="shrink-0 text-muted" /> : <ChevronDown size={12} className="shrink-0 text-muted" />}
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color.accent }} />
          <span className="shrink-0 text-xs font-medium">FX — {channelName}</span>
          {!collapsed && (
            <span className="truncate text-[10px] text-muted">
              drag a device from the sidebar into the rack, or drag a card to reorder it
            </span>
          )}
        </button>
        {inputOptions && onInputChange && (
          <label
            className="mr-3 flex shrink-0 items-center gap-1.5 text-[10px] text-muted"
            title="Where this track's input comes from: the audio interface, or another track - taken before its effects (Pre FX), after them (Post FX) or after its fader. Monitor to hear it through this track's effects; Record to record it."
          >
            Audio from
            <select
              value={inputOptions.some((o) => o.value === inputValue) ? inputValue : ""}
              onChange={(e) => onInputChange(e.target.value, inputTap)}
              className="max-w-[150px] rounded border border-border bg-surface px-1 py-0.5 text-[11px] text-foreground"
            >
              {inputOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {inputValue && (
              <select
                aria-label="Where on that track"
                value={inputTap}
                onChange={(e) => onInputChange(inputValue, e.target.value as SidechainTap)}
                className="rounded border border-border bg-surface px-1 py-0.5 text-[11px] text-foreground"
              >
                {SIDECHAIN_TAPS.map((tap) => (
                  <option key={tap} value={tap}>
                    {SIDECHAIN_TAP_LABELS[tap]}
                  </option>
                ))}
              </select>
            )}
          </label>
        )}
        {outputOptions && onOutputChange && (
          <label
            className="mr-2 flex shrink-0 items-center gap-1.5 text-[10px] text-muted"
            title="Where this track's audio goes: the master, its group, or another track (whose effects then process it too)"
          >
            Audio to
            <select
              value={outputOptions.some((o) => o.value === outputValue) ? outputValue : ""}
              onChange={(e) => onOutputChange(e.target.value)}
              className="max-w-[160px] rounded border border-border bg-surface px-1 py-0.5 text-[11px] text-foreground"
            >
              {outputOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!collapsed && (
      <div className="flex flex-1 items-stretch gap-0 overflow-x-auto p-2">
        {channelType === "midi" && (
          <div className={`flex ${instrument === "synth" || instrument === "drums" ? "w-[262px]" : "w-56"} shrink-0 flex-col rounded border border-border bg-surface-raised p-2`}>
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
            {instrument === "drums" && drumParams && <DrumRackCard channelId={hostId} kit={drumParams} onOpen={onOpenDrumRack} />}
            {instrument === "synth" && synthParams && (
              <SynthRackCard params={synthParams} onChange={onSynthParamsChange} onDragStart={onParamDragStart} onOpen={onOpenSynthSettings} />
            )}
          </div>
        )}

        <DropGap index={0} active={dragOverGap === 0} onDragOverGap={setDragOverGap} onDropAt={handleDropAt} />

        {effects.map((fx, i) => (
          <div key={fx.id} className="flex items-stretch">
            <div
              className={`flex shrink-0 ${
                fx.type === "eq3"
                  ? "w-64 rounded-xl"
                  : fx.type === "compressor" || fx.type === "delay" || fx.type === "limiter" || fx.type === "filter" || fx.type === "chorus" || fx.type === "pitchShift" || fx.type === "distortion" || fx.type === "irLoader" || fx.type === "namAmp" || fx.type === "tubeAmp" || fx.type === "gate" || fx.type === "utility" || fx.type === "tuner" || fx.type === "glue"
                    ? "w-72 rounded-xl"
                    : fx.type === "reverb" || fx.type === "paramEq" || fx.type === "multiband" || fx.type === "mbDynamics"
                      ? "w-80 rounded-xl"
                      : "w-40 rounded border border-border bg-surface-raised"
              } ${fx.bypass ? "opacity-50" : ""}`}
              style={CUSTOM_UI_TYPES.includes(fx.type) ? { background: "#1B1C22", border: "1px solid #2E2F37" } : undefined}
            >
              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(REORDER_DRAG_MIME, fx.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                title="Drag to reorder"
                className="flex w-3 shrink-0 cursor-grab items-center justify-center rounded-l hover:bg-black/10 active:cursor-grabbing"
              >
                <GripVertical size={10} className="text-muted" />
              </div>
              <div className={`flex min-w-0 flex-1 flex-col ${CUSTOM_UI_TYPES.includes(fx.type) ? "p-2.5 pl-1.5" : "p-2 pl-1"}`}>
                <div className="flex min-h-0 flex-1 flex-col">
                {fx.type === "eq3" ? (
                  <EQThreeRackCard
                    params={fx.params}
                    bypass={!!fx.bypass}
                    onBypassToggle={() => onBypassToggle(fx.id)}
                    onRemove={() => onRemoveEffect(fx.id)}
                    onExpand={() => onOpenEffectWindow?.(fx.id)}
                    onParamChange={(key, v) => onParamChange(fx.id, key, v)}
                    onParamDragStart={onParamDragStart}
                  />
                ) : fx.type === "compressor" ? (
                  <CompressorRackCard
                    sidechainName={sidechainSourceName(fx.sidechain, sidechainSources ?? [])}
                    params={fx.params}
                    bypass={!!fx.bypass}
                    onBypassToggle={() => onBypassToggle(fx.id)}
                    onRemove={() => onRemoveEffect(fx.id)}
                    onExpand={() => onOpenEffectWindow?.(fx.id)}
                    onParamChange={(key, v) => onParamChange(fx.id, key, v)}
                    onParamDragStart={onParamDragStart}
                  />
                ) : fx.type === "delay" ? (
                  <DelayRackCard
                    params={fx.params}
                    bpm={bpm}
                    bypass={!!fx.bypass}
                    onBypassToggle={() => onBypassToggle(fx.id)}
                    onRemove={() => onRemoveEffect(fx.id)}
                    onExpand={() => onOpenEffectWindow?.(fx.id)}
                    onParamChange={(key, v) => onParamChange(fx.id, key, v)}
                    onParamDragStart={onParamDragStart}
                  />
                ) : fx.type === "distortion" ? (
                  <SaturatorRackCard
                    params={fx.params}
                    bypass={!!fx.bypass}
                    onBypassToggle={() => onBypassToggle(fx.id)}
                    onRemove={() => onRemoveEffect(fx.id)}
                    onExpand={() => onOpenEffectWindow?.(fx.id)}
                    onParamChange={(key, v) => onParamChange(fx.id, key, v)}
                    onParamDragStart={onParamDragStart}
                  />
                ) : fx.type === "pitchShift" ? (
                  <PitchShiftRackCard
                    params={fx.params}
                    bypass={!!fx.bypass}
                    onBypassToggle={() => onBypassToggle(fx.id)}
                    onRemove={() => onRemoveEffect(fx.id)}
                    onExpand={() => onOpenEffectWindow?.(fx.id)}
                    onParamChange={(key, v) => onParamChange(fx.id, key, v)}
                    onParamDragStart={onParamDragStart}
                  />
                ) : fx.type === "chorus" ? (
                  <ChorusRackCard
                    params={fx.params}
                    bypass={!!fx.bypass}
                    onBypassToggle={() => onBypassToggle(fx.id)}
                    onRemove={() => onRemoveEffect(fx.id)}
                    onExpand={() => onOpenEffectWindow?.(fx.id)}
                    onParamChange={(key, v) => onParamChange(fx.id, key, v)}
                    onParamDragStart={onParamDragStart}
                  />
                ) : fx.type === "filter" ? (
                  <FilterRackCard
                    params={fx.params}
                    bypass={!!fx.bypass}
                    onBypassToggle={() => onBypassToggle(fx.id)}
                    onRemove={() => onRemoveEffect(fx.id)}
                    onExpand={() => onOpenEffectWindow?.(fx.id)}
                    onParamChange={(key, v) => onParamChange(fx.id, key, v)}
                    onParamDragStart={onParamDragStart}
                  />
                ) : fx.type === "limiter" ? (
                  <LimiterRackCard
                    params={fx.params}
                    bypass={!!fx.bypass}
                    onBypassToggle={() => onBypassToggle(fx.id)}
                    onRemove={() => onRemoveEffect(fx.id)}
                    onExpand={() => onOpenEffectWindow?.(fx.id)}
                    onParamChange={(key, v) => onParamChange(fx.id, key, v)}
                    onParamDragStart={onParamDragStart}
                  />
                ) : fx.type === "paramEq" ? (
                  <ParamEqRackCard
                    params={fx.params}
                    bypass={!!fx.bypass}
                    onBypassToggle={() => onBypassToggle(fx.id)}
                    onRemove={() => onRemoveEffect(fx.id)}
                    onExpand={() => onOpenEffectWindow?.(fx.id)}
                    onParamChange={(key, v) => onParamChange(fx.id, key, v)}
                    onParamDragStart={onParamDragStart}
                  />
                ) : fx.type === "utility" ? (
                  <UtilityRackCard
                    params={fx.params}
                    bypass={!!fx.bypass}
                    onBypassToggle={() => onBypassToggle(fx.id)}
                    onRemove={() => onRemoveEffect(fx.id)}
                    onExpand={() => onOpenEffectWindow?.(fx.id)}
                    onParamChange={(key, v) => onParamChange(fx.id, key, v)}
                    onParamDragStart={onParamDragStart}
                  />
                ) : fx.type === "mbDynamics" ? (
                  <MbDynamicsRackCard
                    hostId={hostId}
                    effectId={fx.id}
                    params={fx.params}
                    bypass={!!fx.bypass}
                    sidechainName={sidechainSourceName(fx.sidechain, sidechainSources ?? [])}
                    onBypassToggle={() => onBypassToggle(fx.id)}
                    onRemove={() => onRemoveEffect(fx.id)}
                    onExpand={() => onOpenEffectWindow?.(fx.id)}
                    onParamChange={(key, v) => onParamChange(fx.id, key, v)}
                    onParamDragStart={onParamDragStart}
                  />
                ) : fx.type === "tubeAmp" ? (
                  <FurnaceRackCard
                    params={fx.params}
                    bypass={!!fx.bypass}
                    onBypassToggle={() => onBypassToggle(fx.id)}
                    onRemove={() => onRemoveEffect(fx.id)}
                    onExpand={() => onOpenEffectWindow?.(fx.id)}
                    onParamChange={(key, v) => onParamChange(fx.id, key, v)}
                    onParamDragStart={onParamDragStart}
                  />
                ) : fx.type === "glue" ? (
                  <GlueRackCard
                    hostId={hostId}
                    effectId={fx.id}
                    params={fx.params}
                    bypass={!!fx.bypass}
                    sidechainName={sidechainSourceName(fx.sidechain, sidechainSources ?? [])}
                    onBypassToggle={() => onBypassToggle(fx.id)}
                    onRemove={() => onRemoveEffect(fx.id)}
                    onExpand={() => onOpenEffectWindow?.(fx.id)}
                    onParamChange={(key, v) => onParamChange(fx.id, key, v)}
                    onParamDragStart={onParamDragStart}
                  />
                ) : fx.type === "tuner" ? (
                  <TunerRackCard
                    hostId={hostId}
                    effectId={fx.id}
                    params={fx.params}
                    bypass={!!fx.bypass}
                    onBypassToggle={() => onBypassToggle(fx.id)}
                    onRemove={() => onRemoveEffect(fx.id)}
                    onExpand={() => onOpenEffectWindow?.(fx.id)}
                    onParamChange={(key, v) => onParamChange(fx.id, key, v)}
                    onParamDragStart={onParamDragStart}
                  />
                ) : fx.type === "multiband" ? (
                  <MultibandRackCard
                    hostId={hostId}
                    effectId={fx.id}
                    sidechainName={sidechainSourceName(fx.sidechain, sidechainSources ?? [])}
                    params={fx.params}
                    bypass={!!fx.bypass}
                    onBypassToggle={() => onBypassToggle(fx.id)}
                    onRemove={() => onRemoveEffect(fx.id)}
                    onExpand={() => onOpenEffectWindow?.(fx.id)}
                    onParamChange={(key, v) => onParamChange(fx.id, key, v)}
                    onParamDragStart={onParamDragStart}
                  />
                ) : fx.type === "gate" ? (
                  <GateRackCard
                    sidechainName={sidechainSourceName(fx.sidechain, sidechainSources ?? [])}
                    params={fx.params}
                    bypass={!!fx.bypass}
                    onBypassToggle={() => onBypassToggle(fx.id)}
                    onRemove={() => onRemoveEffect(fx.id)}
                    onExpand={() => onOpenEffectWindow?.(fx.id)}
                    onParamChange={(key, v) => onParamChange(fx.id, key, v)}
                    onParamDragStart={onParamDragStart}
                  />
                ) : fx.type === "namAmp" ? (
                  <NamAmpRackCard
                    params={fx.params}
                    file={fx.file}
                    bypass={!!fx.bypass}
                    onBypassToggle={() => onBypassToggle(fx.id)}
                    onRemove={() => onRemoveEffect(fx.id)}
                    onExpand={() => onOpenEffectWindow?.(fx.id)}
                    onParamChange={(key, v) => onParamChange(fx.id, key, v)}
                    onParamDragStart={onParamDragStart}
                    onLoadFile={(file) => onLoadEffectFile?.(fx.id, file) ?? Promise.resolve("Can't load files here.")}
                    onClearFile={() => onClearEffectFile?.(fx.id)}
                  />
                ) : fx.type === "irLoader" ? (
                  <IrLoaderRackCard
                    params={fx.params}
                    file={fx.file}
                    bypass={!!fx.bypass}
                    onBypassToggle={() => onBypassToggle(fx.id)}
                    onRemove={() => onRemoveEffect(fx.id)}
                    onExpand={() => onOpenEffectWindow?.(fx.id)}
                    onParamChange={(key, v) => onParamChange(fx.id, key, v)}
                    onParamDragStart={onParamDragStart}
                    onLoadFile={(file) => onLoadEffectFile?.(fx.id, file) ?? Promise.resolve("Can't load files here.")}
                    onClearFile={() => onClearEffectFile?.(fx.id)}
                  />
                ) : fx.type === "reverb" ? (
                  <ReverbRackCard
                    params={fx.params}
                    bypass={!!fx.bypass}
                    onBypassToggle={() => onBypassToggle(fx.id)}
                    onRemove={() => onRemoveEffect(fx.id)}
                    onExpand={() => onOpenEffectWindow?.(fx.id)}
                    onParamChange={(key, v) => onParamChange(fx.id, key, v)}
                    onParamDragStart={onParamDragStart}
                  />
                ) : (
                  <>
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
                  </>
                )}
                </div>
                {onPresetChange && (
                  <div className="mt-1.5">
                    <PresetMenu variant="rack" effect={fx} bpm={bpm} onChange={(change) => onPresetChange(fx.id, change)} />
                  </div>
                )}
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
          <div className="flex max-h-[214px] w-[172px] shrink-0 flex-col self-start rounded border border-border bg-surface-raised p-2">
            <div className="mb-1.5 flex items-baseline justify-between text-[10px] font-semibold uppercase tracking-wide text-muted">
              Sends
              {buses.length > 6 && <span className="font-normal normal-case tracking-normal text-muted/70">{buses.length} buses · scroll</span>}
            </div>
            {/* Many buses scroll inside the card instead of growing past the rack. */}
            <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-x-1.5 gap-y-2 overflow-y-auto overflow-x-hidden pr-0.5">
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
      )}
    </div>
  );
}

