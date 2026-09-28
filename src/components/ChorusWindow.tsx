"use client";

import { Power, X } from "lucide-react";
import { PluginKnob, type KnobMode } from "./PluginKnob";
import { PluginIcon } from "./PluginIcon";
import { ChorusGraph } from "./ChorusGraph";
import { paramSpecs, type ParamSpec } from "@/lib/effects";
import { CHORUS_WAVEFORMS, chorusDelayRange, chorusWaveformFromParam } from "@/lib/chorusModel";
import { fraunces, spaceGrotesk } from "@/lib/pluginFonts";
import { WindowPresetMenu } from "./PresetMenu";

interface ChorusWindowProps {
  channelName: string;
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onClose: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}

export const CHORUS_KNOBS: { key: string; mode: KnobMode }[] = [
  { key: "frequency", mode: "log" },
  { key: "delayTime", mode: "log" },
  { key: "depth", mode: "linear" },
  { key: "feedback", mode: "linear" },
  { key: "spread", mode: "linear" },
  { key: "wet", mode: "linear" },
];

export function chorusSpec(key: string): ParamSpec {
  return paramSpecs("chorus").find((s) => s.key === key)!;
}

export function chorusParam(params: Record<string, number>, key: string): number {
  return params[key] ?? chorusSpec(key).default;
}

/** The full Chorus plugin window - the L/R modulation graph, six knobs with
 * readouts, the Sine/Triangle selector, and the live delay-sweep readout -
 * opened from the compact FX rack card's expand button. */
export function ChorusWindow({
  channelName,
  params,
  bypass,
  onBypassToggle,
  onClose,
  onParamChange,
  onParamDragStart,
}: ChorusWindowProps) {
  const value = (key: string) => chorusParam(params, key);
  const waveform = chorusWaveformFromParam(value("waveform"));
  const [minMs, maxMs] = chorusDelayRange(value("delayTime"), value("depth"));

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
              Chorus
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

        <ChorusGraph rate={value("frequency")} depth={value("depth")} spread={value("spread")} waveform={waveform} />

        <div className="flex justify-around px-1 pt-1">
          {CHORUS_KNOBS.map(({ key, mode }) => {
            const spec = chorusSpec(key);
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

        <div className="flex items-center justify-between">
          <div className="flex gap-0.5 rounded-lg p-0.5" style={{ border: "1px solid #2E2F37" }} role="radiogroup" aria-label="LFO waveform">
            {CHORUS_WAVEFORMS.map((w, i) => {
              const selected = w === waveform;
              return (
                <button
                  key={w}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    if (selected) return;
                    onParamDragStart?.();
                    onParamChange("waveform", i);
                  }}
                  className="rounded-md px-3.5 py-1.5 text-[12px] font-bold uppercase tracking-wide"
                  style={{ background: selected ? "#2E2F37" : "transparent", color: selected ? "#F4EDE2" : "#8A8A94" }}
                >
                  {w}
                </button>
              );
            })}
          </div>
          <span className="font-mono text-[12px] text-muted">
            Delay {(minMs + 1e-9).toFixed(1)}–{(maxMs + 1e-9).toFixed(1)} ms
          </span>
        </div>
      </div>
    </div>
  );
}
