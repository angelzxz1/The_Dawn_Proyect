"use client";

import { Power, X } from "lucide-react";
import { PluginKnob, type KnobMode } from "@/ui/PluginKnob";
import { PluginIcon } from "@/effects/ui/PluginIcon";
import { PitchShiftKeyboard } from "./PitchShiftKeyboard";
import { paramSpecs, type ParamSpec } from "@/effects/registry";
import { shiftReadout } from "./pitchInterval";
import { fraunces, spaceGrotesk } from "@/ui/pluginFonts";
import { WindowPresetMenu } from "@/effects/ui/PresetMenu";

interface PitchShiftWindowProps {
  channelName: string;
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onClose: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}

export const PITCH_KNOBS: { key: string; mode: KnobMode }[] = [
  { key: "pitch", mode: "bipolar" },
  { key: "fine", mode: "bipolar" },
  { key: "window", mode: "log" },
  { key: "feedback", mode: "linear" },
  { key: "wet", mode: "linear" },
];

export function pitchSpec(key: string): ParamSpec {
  return paramSpecs("pitchShift").find((s) => s.key === key)!;
}

export function pitchParam(params: Record<string, number>, key: string): number {
  return params[key] ?? pitchSpec(key).default;
}

/** Pitch snaps to whole semitones and Fine to whole cents as they're
 * dragged or typed. */
export function snapPitchParam(key: string, value: number): number {
  return key === "pitch" || key === "fine" ? Math.round(value) : value;
}

/** The full Pitch Shift plugin window - the keyboard showing where C4
 * lands, five knobs with readouts, and the C4 -> target readout - opened
 * from the compact FX rack card's expand button. */
export function PitchShiftWindow({
  channelName,
  params,
  bypass,
  onBypassToggle,
  onClose,
  onParamChange,
  onParamDragStart,
}: PitchShiftWindowProps) {
  const value = (key: string) => pitchParam(params, key);

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
              Pitch Shift
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

        <PitchShiftKeyboard pitch={value("pitch")} fine={value("fine")} />

        <div className="flex justify-around px-1 pt-1">
          {PITCH_KNOBS.map(({ key, mode }) => {
            const spec = pitchSpec(key);
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
                onChange={(v) => onParamChange(key, snapPitchParam(key, v))}
                onDragStart={onParamDragStart}
                formatValue={spec.format}
              />
            );
          })}
        </div>

        <div style={{ height: 1, background: "#2E2F37" }} />

        <div className="flex justify-end">
          <span className="font-mono text-[12px] text-muted">{shiftReadout(value("pitch"), value("fine"))}</span>
        </div>
      </div>
    </div>
  );
}
