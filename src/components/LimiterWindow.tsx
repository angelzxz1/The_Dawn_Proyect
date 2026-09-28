"use client";

import { useRef } from "react";
import { Power, X } from "lucide-react";
import { PluginKnob, type KnobMode } from "./PluginKnob";
import { PluginIcon } from "./PluginIcon";
import { LimiterMeters } from "./LimiterMeters";
import { paramSpecs, type ParamSpec } from "@/lib/effects";
import { fraunces, spaceGrotesk } from "@/lib/pluginFonts";
import { WindowPresetMenu } from "./PresetMenu";

interface LimiterWindowProps {
  channelName: string;
  hostId: string;
  effectId: string;
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onClose: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}

/** Gain is bipolar (0dB at 12 o'clock), Ceiling is a plain dB sweep,
 * Release is a time and feels natural on a log sweep. */
export const LIMITER_KNOBS: { key: string; mode: KnobMode }[] = [
  { key: "gain", mode: "bipolar" },
  { key: "threshold", mode: "linear" },
  { key: "release", mode: "log" },
];

export function limiterSpec(key: string): ParamSpec {
  return paramSpecs("limiter").find((s) => s.key === key)!;
}

/** The full Limiter plugin window - live input/output/gain-reduction
 * meters against the ceiling, Gain/Ceiling/Release knobs, the Soft Clip
 * toggle, and a live "Limiting" readout - opened from the compact FX rack
 * card's expand button. */
export function LimiterWindow({
  channelName,
  hostId,
  effectId,
  params,
  bypass,
  onBypassToggle,
  onClose,
  onParamChange,
  onParamDragStart,
}: LimiterWindowProps) {
  const value = (key: string) => params[key] ?? limiterSpec(key).default;
  const softClipOn = value("softClip") >= 0.5;
  const limitingReadout = useRef<HTMLSpanElement>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className={`${spaceGrotesk.className} flex w-[620px] flex-col gap-4 rounded-2xl shadow-2xl`}
        style={{ background: "#1B1C22", border: "1px solid #2E2F37", padding: "18px 22px 20px" }}
      >
        <div className="flex h-[30px] items-center justify-between">
          <div className="flex items-center gap-2">
            <PluginIcon />
            <h2 className={`${fraunces.className} text-[19px] font-semibold text-[#F4EDE2]`} style={{ letterSpacing: "-0.2px" }}>
              Limiter
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

        <LimiterMeters
          hostId={hostId}
          effectId={effectId}
          gainDb={value("gain")}
          ceilingDb={value("threshold")}
          limitingReadoutRef={limitingReadout}
        />

        <div className="flex justify-around px-6 pt-1">
          {LIMITER_KNOBS.map(({ key, mode }) => {
            const spec = limiterSpec(key);
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
          <button
            type="button"
            aria-pressed={softClipOn}
            title="Round off peaks with gentle saturation before limiting"
            onClick={() => {
              onParamDragStart?.();
              onParamChange("softClip", softClipOn ? 0 : 1);
            }}
            className="flex items-center gap-2.5 rounded-lg px-4 py-2 text-[12px] font-bold uppercase tracking-wider"
            style={{
              background: softClipOn ? "rgba(230,173,94,0.14)" : "#23242B",
              border: `1px solid ${softClipOn ? "#E6AD5E" : "#2E2F37"}`,
              color: softClipOn ? "#E6AD5E" : "#9A9AA4",
            }}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: softClipOn ? "#E6AD5E" : "#5A5B64" }} />
            Soft Clip
          </button>
          <span ref={limitingReadout} className="font-mono text-[12px] text-muted">
            Limiting 0.0 dB
          </span>
        </div>
      </div>
    </div>
  );
}
