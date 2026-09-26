"use client";

import { Power, X } from "lucide-react";
import { PluginKnob, type KnobMode } from "./PluginKnob";
import { ReverbGraph } from "./ReverbGraph";
import { PluginIcon } from "./PluginIcon";
import { paramSpecs, type ParamSpec } from "@/lib/effects";
import { REVERB_MODES, highsRt60, reverbModeFromParam } from "@/lib/reverbModel";
import { fraunces, spaceGrotesk } from "@/lib/pluginFonts";

interface ReverbWindowProps {
  channelName: string;
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onClose: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}

/** Knob curve per param - frequencies and times feel natural on a log
 * sweep; percentages and pre-delay (which starts at 0) are linear. */
export const REVERB_KNOB_MODES: Record<string, KnobMode> = {
  preDelay: "linear",
  decay: "log",
  damping: "log",
  early: "linear",
  lowCut: "log",
  highCut: "log",
  width: "linear",
  wet: "linear",
};

export const REVERB_KNOB_KEYS = ["preDelay", "decay", "damping", "early", "lowCut", "highCut", "width", "wet"];

export function reverbSpec(key: string): ParamSpec {
  return paramSpecs("reverb").find((s) => s.key === key)!;
}

/** The full Reverb plugin window - the response graph, all eight knobs with
 * readouts, the Hall/Room/Plate selector, and the live RT60 readout -
 * opened from the compact FX rack card's expand button. */
export function ReverbWindow({
  channelName,
  params,
  bypass,
  onBypassToggle,
  onClose,
  onParamChange,
  onParamDragStart,
}: ReverbWindowProps) {
  const value = (key: string) => params[key] ?? reverbSpec(key).default;
  const mode = reverbModeFromParam(value("mode"));
  const decay = value("decay");
  const highs = highsRt60(decay, value("damping"));

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
              Reverb
            </h2>
            <span className="text-xs text-muted">— {channelName}</span>
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

        <ReverbGraph
          preDelay={value("preDelay")}
          decay={decay}
          damping={value("damping")}
          early={value("early")}
          lowCut={value("lowCut")}
          highCut={value("highCut")}
          mode={mode}
        />

        <div className="flex justify-between px-1 pt-1">
          {REVERB_KNOB_KEYS.map((key) => {
            const spec = reverbSpec(key);
            return (
              <PluginKnob
                key={key}
                label={spec.label}
                value={value(key)}
                min={spec.min}
                max={spec.max}
                defaultValue={spec.default}
                mode={REVERB_KNOB_MODES[key]}
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
          <div className="flex gap-0.5 rounded-lg p-0.5" style={{ border: "1px solid #2E2F37" }} role="radiogroup" aria-label="Reverb type">
            {REVERB_MODES.map((m, i) => {
              const selected = m === mode;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    if (selected) return;
                    onParamDragStart?.();
                    onParamChange("mode", i);
                  }}
                  className="rounded-md px-3.5 py-1.5 text-[12px] font-bold uppercase tracking-wide"
                  style={{ background: selected ? "#2E2F37" : "transparent", color: selected ? "#F4EDE2" : "#8A8A94" }}
                >
                  {m}
                </button>
              );
            })}
          </div>

          <span className="font-mono text-[12px] text-muted">
            RT60 {decay.toFixed(2)} s · highs {highs.toFixed(2)} s
          </span>
        </div>
      </div>
    </div>
  );
}
