"use client";

import { Power, X } from "lucide-react";
import { PluginKnob, type KnobMode } from "@/effects/ui/PluginKnob";
import { PluginIcon } from "@/effects/ui/PluginIcon";
import { NamDisplay } from "./NamDisplay";
import { NamFileSlot, useNamModel } from "./NamFileSlot";
import { paramSpecs, type EffectFileRef, type ParamSpec } from "@/effects/registry";
import { normalizationDb } from "./namModel";
import { fraunces, spaceGrotesk } from "@/effects/ui/pluginFonts";
import { WindowPresetMenu } from "@/effects/ui/PresetMenu";
import { TonePicker } from "@/studio/rack/TonePicker";

interface NamAmpWindowProps {
  hostId: string;
  effectId: string;
  channelName: string;
  params: Record<string, number>;
  file: EffectFileRef | undefined;
  bypass: boolean;
  onBypassToggle: () => void;
  onClose: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
  onLoadFile: (file: File) => Promise<string | null>;
  onClearFile: () => void;
  /** Loads one of Dawn's factory files (a cabinet) by reference. */
  onPickFile?: (ref: EffectFileRef) => void;
}

export const NAM_AMP_KNOBS: { key: string; mode: KnobMode }[] = [
  { key: "input", mode: "bipolar" },
  { key: "bass", mode: "linear" },
  { key: "middle", mode: "linear" },
  { key: "treble", mode: "linear" },
  { key: "output", mode: "bipolar" },
];

export function namAmpSpec(key: string): ParamSpec {
  return paramSpecs("namAmp").find((s) => s.key === key)!;
}

export function namAmpParam(params: Record<string, number>, key: string): number {
  return params[key] ?? namAmpSpec(key).default;
}

function Segmented({
  label,
  options,
  selected,
  disabled = false,
  onSelect,
}: {
  label: string;
  options: string[];
  selected: number;
  disabled?: boolean;
  onSelect: (index: number) => void;
}) {
  return (
    <div
      className="flex gap-0.5 rounded-lg p-0.5"
      style={{ border: "1px solid #2E2F37", opacity: disabled ? 0.45 : 1 }}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option, i) => {
        const isSelected = i === selected;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={disabled}
            onClick={() => {
              if (!isSelected) onSelect(i);
            }}
            className="rounded-md px-3.5 py-1.5 text-[12px] font-bold uppercase tracking-wide"
            style={{ background: isSelected ? "#2E2F37" : "transparent", color: isSelected ? "#F4EDE2" : "#8A8A94" }}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

/** The full NAM Amp window - the loaded model and what it reports about
 * itself, the tone stack's curve, the input meter, the file slot, five
 * knobs, and the Normalize and (A2 models only) Full/Lite switches. */
export function NamAmpWindow({
  hostId,
  effectId,
  channelName,
  params,
  file,
  bypass,
  onBypassToggle,
  onClose,
  onParamChange,
  onParamDragStart,
  onLoadFile,
  onClearFile,
  onPickFile,
}: NamAmpWindowProps) {
  const value = (key: string) => namAmpParam(params, key);
  const model = useNamModel(file);
  const info = model.status === "ready" ? model.info : null;
  const normalize = value("normalize") >= 0.5;
  const normalizeDb = normalize && info?.loudness != null ? normalizationDb(true, info.loudness) : null;
  const pick = (key: string, index: number) => {
    onParamDragStart?.();
    onParamChange(key, index);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className={`${spaceGrotesk.className} flex w-[880px] flex-col gap-4 rounded-2xl shadow-2xl`}
        style={{ background: "#1B1C22", border: "1px solid #2E2F37", padding: "18px 22px 20px" }}
      >
        <div className="flex h-[30px] items-center justify-between">
          <div className="flex items-center gap-2">
            <PluginIcon />
            <h2 className={`${fraunces.className} text-[19px] font-semibold text-[#F4EDE2]`} style={{ letterSpacing: "-0.2px" }}>
              NAM Amp
            </h2>
            <span className="text-xs text-muted">— {channelName}</span>
            <div className="ml-3">
              <WindowPresetMenu />
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              title={bypass ? "Enable effect" : "Bypass effect"}
              onClick={onBypassToggle}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-lg"
              style={{ background: "#23242B", border: "1px solid #2E2F37" }}
            >
              <Power size={16} color={bypass ? "#5A5B64" : "#E6AD5E"} />
            </button>
            <button
              type="button"
              title="Close"
              onClick={onClose}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-lg"
            >
              <X size={14} color="#9A9AA4" />
            </button>
          </div>
        </div>

        <NamDisplay
          hostId={hostId}
          effectId={effectId}
          model={model}
          fileName={file?.name}
          bass={value("bass")}
          middle={value("middle")}
          treble={value("treble")}
          normalizeDb={normalizeDb}
        />

        <div className="flex items-center gap-6">
          <div className="w-[280px] shrink-0">
            <NamFileSlot file={file} model={model} onLoad={onLoadFile} onClear={onClearFile} />
            {onPickFile && (
              <div className="mt-2">
                <TonePicker kind="amp" currentId={file?.id} onPick={onPickFile} onLoadFile={onLoadFile} />
              </div>
            )}
          </div>
          <div className="flex flex-1 justify-around">
            {NAM_AMP_KNOBS.map(({ key, mode }) => {
              const spec = namAmpSpec(key);
              return (
                <PluginKnob
                  key={key}
                  label={spec.label}
                  value={value(key)}
                  min={spec.min}
                  max={spec.max}
                  defaultValue={spec.default}
                  mode={mode}
                  size={50}
                  showReadout
                  onChange={(v) => onParamChange(key, v)}
                  onDragStart={onParamDragStart}
                  formatValue={spec.format}
                />
              );
            })}
          </div>
        </div>

        <div style={{ height: 1, background: "#2E2F37" }} />

        <div className="flex items-center gap-3">
          <span className="text-[12px] font-bold uppercase tracking-wide" style={{ color: "#8A8A94" }}>
            Normalize
          </span>
          <Segmented label="Normalize" options={["Off", "On"]} selected={normalize ? 1 : 0} onSelect={(i) => pick("normalize", i)} />
          <span className="ml-3 text-[12px] font-bold uppercase tracking-wide" style={{ color: "#8A8A94" }}>
            Size
          </span>
          <Segmented
            label="Model size"
            options={["Lite", "Full"]}
            selected={value("size") >= 0.5 ? 1 : 0}
            disabled={!info?.isA2}
            onSelect={(i) => pick("size", i)}
          />
          <span className="ml-auto max-w-[300px] text-right text-[12px] leading-snug text-muted">
            {!info?.isA2
              ? "Size applies to A2 models, which include a lighter Lite version."
              : value("size") >= 0.5
                ? "Full: the capture at its best accuracy."
                : "Lite: the same capture at lower resolution, several times lighter on the CPU."}
          </span>
        </div>
      </div>
    </div>
  );
}
