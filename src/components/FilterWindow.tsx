"use client";

import { Power, X } from "lucide-react";
import { PluginKnob, type KnobMode } from "./PluginKnob";
import { PluginIcon } from "./PluginIcon";
import { FilterGraph } from "./FilterGraph";
import { paramSpecs, type ParamSpec } from "@/lib/effects";
import {
  FILTER_MODES,
  FILTER_SLOPES,
  LFO_MAX_OCTAVES,
  filterModeFromParam,
  filterUsesGain,
  filterUsesSlope,
  slopeIndexFromParam,
} from "@/lib/filterModel";
import { fraunces, spaceGrotesk } from "@/lib/pluginFonts";
import { WindowPresetMenu } from "./PresetMenu";

interface FilterWindowProps {
  channelName: string;
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onClose: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}

export const FILTER_KNOBS: { key: string; mode: KnobMode }[] = [
  { key: "frequency", mode: "log" },
  { key: "Q", mode: "log" },
  { key: "gain", mode: "bipolar" },
  { key: "lfoRate", mode: "log" },
  { key: "lfoDepth", mode: "linear" },
  { key: "wet", mode: "linear" },
];

export function filterSpec(key: string): ParamSpec {
  return paramSpecs("filter").find((s) => s.key === key)!;
}

export function filterParam(params: Record<string, number>, key: string): number {
  return params[key] ?? filterSpec(key).default;
}

/** "LFO off", or how far and how fast the LFO sweeps the cutoff. */
export function lfoSummary(params: Record<string, number>): string {
  const depth = filterParam(params, "lfoDepth");
  if (depth <= 0.001) return "LFO off";
  return `LFO ±${(depth * LFO_MAX_OCTAVES).toFixed(1)} oct · ${filterParam(params, "lfoRate").toFixed(2)} Hz`;
}

function Segmented({
  label,
  options,
  selected,
  disabled,
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
      style={{ border: "1px solid #2E2F37", opacity: disabled ? 0.4 : 1 }}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled}
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
            className="rounded-md px-3 py-1.5 text-[12px] font-bold uppercase tracking-wide disabled:cursor-default"
            style={{ background: isSelected ? "#2E2F37" : "transparent", color: isSelected ? "#F4EDE2" : "#8A8A94" }}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

/** The full Filter plugin window - the live response graph, six knobs with
 * readouts (Gain only active for Peak/shelves), the type and slope
 * selectors (slope only for the cut/pass types), and the LFO summary -
 * opened from the compact FX rack card's expand button. */
export function FilterWindow({
  channelName,
  params,
  bypass,
  onBypassToggle,
  onClose,
  onParamChange,
  onParamDragStart,
}: FilterWindowProps) {
  const value = (key: string) => filterParam(params, key);
  const mode = filterModeFromParam(value("mode"));
  const slopeIndex = slopeIndexFromParam(value("slope"));
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
              Filter
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

        <FilterGraph
          mode={mode}
          frequency={value("frequency")}
          q={value("Q")}
          gainDb={value("gain")}
          slopeIndex={slopeIndex}
          wet={value("wet")}
          lfoDepth={value("lfoDepth")}
        />

        <div className="flex justify-around px-1 pt-1">
          {FILTER_KNOBS.map(({ key, mode: knobMode }) => {
            const spec = filterSpec(key);
            return (
              <PluginKnob
                key={key}
                label={spec.label}
                value={value(key)}
                min={spec.min}
                max={spec.max}
                defaultValue={spec.default}
                mode={knobMode}
                size={54}
                showReadout
                disabled={key === "gain" && !filterUsesGain(mode)}
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
            label="Filter type"
            options={FILTER_MODES.map((m) => m.label)}
            selected={FILTER_MODES.findIndex((m) => m.mode === mode)}
            onSelect={(i) => pick("mode", i)}
          />
          <Segmented
            label="Slope, dB per octave"
            options={FILTER_SLOPES.map(String)}
            selected={slopeIndex}
            disabled={!filterUsesSlope(mode)}
            onSelect={(i) => pick("slope", i)}
          />
          <span className="ml-auto font-mono text-[12px] text-muted">{lfoSummary(params)}</span>
        </div>
      </div>
    </div>
  );
}
