"use client";

import { Power, X } from "lucide-react";
import { PluginKnob } from "./PluginKnob";
import { EQThreeGraph } from "./EQThreeGraph";
import { PluginIcon } from "./PluginIcon";
import { paramSpecs } from "@/lib/effects";
import { fraunces, spaceGrotesk } from "@/lib/pluginFonts";

interface EQThreeWindowProps {
  channelName: string;
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onClose: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}

/** The full EQ Three plugin window - a live frequency-response preview
 * plus every knob with its numeric readout, opened from the compact FX
 * rack card's expand button. */
export function EQThreeWindow({
  channelName,
  params,
  bypass,
  onBypassToggle,
  onClose,
  onParamChange,
  onParamDragStart,
}: EQThreeWindowProps) {
  const specs = paramSpecs("eq3");
  const [lowSpec, midSpec, highSpec, lowXSpec, highXSpec] = specs;
  const value = (key: string, fallback: number) => params[key] ?? fallback;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className={`${spaceGrotesk.className} flex w-[380px] flex-col gap-4 rounded-2xl shadow-2xl`}
        style={{ background: "#1B1C22", border: "1px solid #2E2F37", padding: "18px 20px 20px" }}
      >
        <div className="flex h-[30px] items-center justify-between">
          <div className="flex items-center gap-2">
            <PluginIcon />
            <h2 className={`${fraunces.className} text-[19px] font-semibold text-[#F4EDE2]`} style={{ letterSpacing: "-0.2px" }}>
              EQ Three
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

        <EQThreeGraph
          low={value("low", lowSpec.default)}
          mid={value("mid", midSpec.default)}
          high={value("high", highSpec.default)}
          lowFrequency={value("lowFrequency", lowXSpec.default)}
          highFrequency={value("highFrequency", highXSpec.default)}
        />

        <div className="flex justify-between px-3.5 pt-0.5">
          {[lowSpec, midSpec, highSpec].map((spec) => (
            <PluginKnob
              key={spec.key}
              label={spec.label}
              value={value(spec.key, spec.default)}
              min={spec.min}
              max={spec.max}
              defaultValue={spec.default}
              mode="bipolar"
              size={58}
              showReadout
              onChange={(v) => onParamChange(spec.key, v)}
              onDragStart={onParamDragStart}
              formatValue={spec.format}
            />
          ))}
        </div>

        <div style={{ height: 1, background: "#2E2F37" }} />

        <div className="flex justify-between px-1">
          {[lowXSpec, highXSpec].map((spec) => (
            <PluginKnob
              key={spec.key}
              label={spec.label}
              value={value(spec.key, spec.default)}
              min={spec.min}
              max={spec.max}
              defaultValue={spec.default}
              mode="log"
              size={44}
              showReadout
              layout="inline"
              onChange={(v) => onParamChange(spec.key, v)}
              onDragStart={onParamDragStart}
              formatValue={spec.format}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
