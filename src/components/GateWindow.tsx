"use client";

import { Power, X } from "lucide-react";
import { PluginKnob, type KnobMode } from "./PluginKnob";
import { PluginIcon } from "./PluginIcon";
import { GateGraph } from "./GateGraph";
import { paramSpecs, type ParamSpec } from "@/lib/effects";
import { HYSTERESIS_DB } from "@/lib/gateModel";
import { SidechainPanel, type SidechainSource } from "./SidechainPanel";
import type { SidechainRouting } from "@/lib/sidechainModel";
import { fraunces, spaceGrotesk } from "@/lib/pluginFonts";
import { WindowPresetMenu } from "./PresetMenu";

interface GateWindowProps {
  hostId: string;
  effectId: string;
  channelName: string;
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onClose: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
  /** The key input's routing, and the tracks/buses it could come from. */
  sidechain?: SidechainRouting;
  sidechainSources: SidechainSource[];
  onSidechainChange: (routing: SidechainRouting) => void;
}

export const GATE_KNOBS: { key: string; mode: KnobMode }[] = [
  { key: "threshold", mode: "linear" },
  { key: "attack", mode: "log" },
  { key: "hold", mode: "linear" },
  { key: "release", mode: "log" },
  { key: "range", mode: "linear" },
];

export function gateSpec(key: string): ParamSpec {
  return paramSpecs("gate").find((s) => s.key === key)!;
}

export function gateParam(params: Record<string, number>, key: string): number {
  return params[key] ?? gateSpec(key).default;
}

/** The full Noise Gate window - the level/threshold history graph and five
 * knobs with readouts - opened from the compact FX rack card. */
export function GateWindow({
  hostId,
  effectId,
  channelName,
  params,
  bypass,
  onBypassToggle,
  onClose,
  onParamChange,
  onParamDragStart,
  sidechain,
  sidechainSources,
  onSidechainChange,
}: GateWindowProps) {
  const value = (key: string) => gateParam(params, key);

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
              Noise Gate
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

        <GateGraph hostId={hostId} effectId={effectId} thresholdDb={value("threshold")} />

        <div className="flex justify-around px-1 pt-1">
          {GATE_KNOBS.map(({ key, mode }) => {
            const spec = gateSpec(key);
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

        <SidechainPanel
          type="gate"
          hostId={hostId}
          effectId={effectId}
          params={params}
          routing={sidechain}
          sources={sidechainSources}
          onRoutingChange={onSidechainChange}
          onParamChange={onParamChange}
          onParamDragStart={onParamDragStart}
        />

        <div style={{ height: 1, background: "#2E2F37" }} />

        <p className="text-[12px] leading-snug text-muted">
          Opens above the threshold and closes once the level falls {HYSTERESIS_DB} dB below it, after Hold. For a
          guitar, put it before the amp: set Threshold just above the hiss you hear when you&apos;re not playing.
        </p>
      </div>
    </div>
  );
}
