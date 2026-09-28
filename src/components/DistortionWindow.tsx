"use client";

import { Power, X } from "lucide-react";
import { PluginKnob, type KnobMode } from "./PluginKnob";
import { PluginIcon } from "./PluginIcon";
import { DistortionGraph } from "./DistortionGraph";
import { paramSpecs, type ParamSpec } from "@/lib/effects";
import {
  DISTORTION_SHAPES,
  OVERSAMPLE_OPTIONS,
  distortionShapeFromParam,
  driveGain,
  oversampleFromParam,
} from "@/lib/distortionModel";
import { fraunces, spaceGrotesk } from "@/lib/pluginFonts";
import { WindowPresetMenu } from "./PresetMenu";

interface DistortionWindowProps {
  channelName: string;
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onClose: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}

export const DISTORTION_KNOBS: { key: string; mode: KnobMode }[] = [
  { key: "distortion", mode: "linear" },
  { key: "bias", mode: "linear" },
  { key: "tone", mode: "log" },
  { key: "output", mode: "bipolar" },
  { key: "wet", mode: "linear" },
];

export function distortionSpec(key: string): ParamSpec {
  return paramSpecs("distortion").find((s) => s.key === key)!;
}

export function distortionParam(params: Record<string, number>, key: string): number {
  return params[key] ?? distortionSpec(key).default;
}

function Segmented({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: string[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="flex gap-0.5 rounded-lg p-0.5" style={{ border: "1px solid #2E2F37" }} role="radiogroup" aria-label={label}>
      {options.map((option, i) => {
        const isSelected = i === selected;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={isSelected}
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

/** The full Distortion plugin window - the transfer curve and in/out
 * waveform, five knobs with readouts, the Soft/Hard/Fold and oversampling
 * selectors, and the drive-gain readout - opened from the compact FX rack
 * card's expand button. */
export function DistortionWindow({
  channelName,
  params,
  bypass,
  onBypassToggle,
  onClose,
  onParamChange,
  onParamDragStart,
}: DistortionWindowProps) {
  const value = (key: string) => distortionParam(params, key);
  const shape = distortionShapeFromParam(value("shape"));
  const oversample = oversampleFromParam(value("oversample"));
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
              Distortion
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

        <DistortionGraph
          shape={shape}
          drive={value("distortion")}
          bias={value("bias")}
          outputDb={value("output")}
          wet={value("wet")}
        />

        <div className="flex justify-around px-1 pt-1">
          {DISTORTION_KNOBS.map(({ key, mode }) => {
            const spec = distortionSpec(key);
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

        <div style={{ height: 1, background: "#2E2F37" }} />

        <div className="flex items-center gap-3">
          <Segmented
            label="Shape"
            options={DISTORTION_SHAPES}
            selected={DISTORTION_SHAPES.indexOf(shape)}
            onSelect={(i) => pick("shape", i)}
          />
          <Segmented
            label="Oversampling"
            options={OVERSAMPLE_OPTIONS.map((o) => o.label)}
            selected={OVERSAMPLE_OPTIONS.findIndex((o) => o.value === oversample)}
            onSelect={(i) => pick("oversample", i)}
          />
          <span className="ml-auto font-mono text-[12px] text-muted">
            Drive ×{driveGain(value("distortion")).toFixed(1)}
          </span>
        </div>
      </div>
    </div>
  );
}
