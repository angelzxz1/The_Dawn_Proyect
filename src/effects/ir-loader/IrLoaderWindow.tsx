"use client";

import { Power, X } from "lucide-react";
import { PluginKnob, type KnobMode } from "@/effects/ui/PluginKnob";
import { PluginIcon } from "@/effects/ui/PluginIcon";
import { IrResponseGraph } from "./IrResponseGraph";
import { IrFileSlot, useImpulseResponse } from "./IrFileSlot";
import { paramSpecs, type EffectFileRef, type ParamSpec } from "@/effects/registry";
import { fraunces, spaceGrotesk } from "@/effects/ui/pluginFonts";
import { WindowPresetMenu } from "@/effects/ui/PresetMenu";
import { TonePicker } from "@/studio/rack/TonePicker";

interface IrLoaderWindowProps {
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

export const IR_LOADER_KNOBS: { key: string; mode: KnobMode }[] = [
  { key: "lowCut", mode: "log" },
  { key: "highCut", mode: "log" },
  { key: "output", mode: "bipolar" },
  { key: "wet", mode: "linear" },
];

export function irLoaderSpec(key: string): ParamSpec {
  return paramSpecs("irLoader").find((s) => s.key === key)!;
}

export function irLoaderParam(params: Record<string, number>, key: string): number {
  return params[key] ?? irLoaderSpec(key).default;
}

export function irEmptyMessage(status: ReturnType<typeof useImpulseResponse>["status"]): string {
  if (status === "missing") return "The IR file is missing - load it again";
  if (status === "loading") return "Reading IR…";
  return "Load an impulse response to hear it - no IR, no change to the sound";
}

/** The full IR Loader window - the IR's waveform and frequency response,
 * the file slot, four knobs with readouts and the Normalize switch -
 * opened from the compact FX rack card's expand button. */
export function IrLoaderWindow({
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
}: IrLoaderWindowProps) {
  const value = (key: string) => irLoaderParam(params, key);
  const impulse = useImpulseResponse(file);
  const normalize = value("normalize") >= 0.5;

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
              IR Loader
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

        <IrResponseGraph
          buffer={impulse.status === "ready" ? impulse.buffer : null}
          emptyMessage={irEmptyMessage(impulse.status)}
          normalize={normalize}
          lowCut={value("lowCut")}
          highCut={value("highCut")}
          outputDb={value("output")}
        />

        <div className="flex items-center gap-6">
          <div className="w-[300px] shrink-0">
            <IrFileSlot file={file} impulse={impulse} onLoad={onLoadFile} onClear={onClearFile} />
            {onPickFile && (
              <div className="mt-2">
                <TonePicker kind="ir" currentId={file?.id} onPick={onPickFile} onLoadFile={onLoadFile} />
              </div>
            )}
          </div>
          <div className="flex flex-1 justify-around">
            {IR_LOADER_KNOBS.map(({ key, mode }) => {
              const spec = irLoaderSpec(key);
              return (
                <PluginKnob
                  key={key}
                  label={spec.label}
                  value={value(key)}
                  min={spec.min}
                  max={spec.max}
                  defaultValue={spec.default}
                  mode={mode}
                  size={54}
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
          <div className="flex gap-0.5 rounded-lg p-0.5" style={{ border: "1px solid #2E2F37" }} role="radiogroup" aria-label="Normalize">
            {["Off", "On"].map((option, i) => {
              const selected = (i === 1) === normalize;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    if (selected) return;
                    onParamDragStart?.();
                    onParamChange("normalize", i);
                  }}
                  className="rounded-md px-3.5 py-1.5 text-[12px] font-bold uppercase tracking-wide"
                  style={{ background: selected ? "#2E2F37" : "transparent", color: selected ? "#F4EDE2" : "#8A8A94" }}
                >
                  {option}
                </button>
              );
            })}
          </div>
          <span className="text-[12px] text-muted">
            {normalize
              ? "IRs are level-matched, so switching between them keeps a similar loudness."
              : "The IR plays at the level it was recorded at."}
          </span>
        </div>
      </div>
    </div>
  );
}
