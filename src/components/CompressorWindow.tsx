"use client";

import { Power, X } from "lucide-react";
import { PluginKnob, type KnobMode } from "./PluginKnob";
import { CompressorGraph } from "./CompressorGraph";
import { CompressorMeters } from "./CompressorMeter";
import { PluginIcon } from "./PluginIcon";
import { autoMakeupDb, paramSpecs } from "@/lib/effects";
import { fraunces, spaceGrotesk } from "@/lib/pluginFonts";

interface CompressorWindowProps {
  channelName: string;
  /** The channel/bus/"master" id this effect instance actually lives on -
   * needed (along with the effect's own id) to poll its live IN/GR/OUT
   * meters from the audio engine. */
  hostId: string;
  effectId: string;
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onClose: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}

/** The full Compressor plugin window - a live transfer-curve graph, IN/GR/
 * OUT meters, every knob with its numeric readout, and an Auto Makeup
 * toggle, opened from the compact FX rack card's expand button. */
export function CompressorWindow({
  channelName,
  hostId,
  effectId,
  params,
  bypass,
  onBypassToggle,
  onClose,
  onParamChange,
  onParamDragStart,
}: CompressorWindowProps) {
  const [thresholdSpec, ratioSpec, attackSpec, releaseSpec, kneeSpec, makeupSpec, makeupAutoSpec, dryWetSpec, outputSpec] =
    paramSpecs("compressor");
  const value = (key: string, fallback: number) => params[key] ?? fallback;

  const threshold = value("threshold", thresholdSpec.default);
  const ratio = value("ratio", ratioSpec.default);
  const knee = value("knee", kneeSpec.default);
  const autoOn = value("makeupAuto", makeupAutoSpec.default) >= 0.5;
  const displayedMakeup = autoOn ? autoMakeupDb(threshold, ratio) : value("makeup", makeupSpec.default);

  const topRow = [thresholdSpec, ratioSpec, attackSpec, releaseSpec];
  const bottomRow = [kneeSpec, makeupSpec, dryWetSpec, outputSpec];

  const modeFor = (key: string): KnobMode => (key === "makeup" || key === "output" ? "bipolar" : "linear");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className={`${spaceGrotesk.className} flex w-[760px] flex-col gap-4 rounded-2xl shadow-2xl`}
        style={{ background: "#1B1C22", border: "1px solid #2E2F37", padding: "18px 22px 20px" }}
      >
        <div className="flex h-[30px] items-center justify-between">
          <div className="flex items-center gap-2">
            <PluginIcon />
            <h2 className={`${fraunces.className} text-[19px] font-semibold text-[#F4EDE2]`} style={{ letterSpacing: "-0.2px" }}>
              Compressor
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

        <div className="flex gap-4">
          <div className="flex w-[280px] shrink-0 flex-col gap-3">
            <CompressorGraph threshold={threshold} ratio={ratio} knee={knee} />
            <CompressorMeters hostId={hostId} effectId={effectId} />
          </div>

          <div className="grid flex-1 grid-cols-4 gap-x-3 gap-y-5 content-start pt-1">
            {topRow.map((spec) => (
              <PluginKnob
                key={spec.key}
                label={spec.label}
                value={value(spec.key, spec.default)}
                min={spec.min}
                max={spec.max}
                defaultValue={spec.default}
                mode={modeFor(spec.key)}
                size={54}
                showReadout
                onChange={(v) => onParamChange(spec.key, v)}
                onDragStart={onParamDragStart}
                formatValue={spec.format}
              />
            ))}
            {bottomRow.map((spec) => (
              <PluginKnob
                key={spec.key}
                label={spec.label}
                value={spec.key === "makeup" ? displayedMakeup : value(spec.key, spec.default)}
                min={spec.min}
                max={spec.max}
                defaultValue={spec.default}
                mode={modeFor(spec.key)}
                size={54}
                showReadout
                disabled={spec.key === "makeup" && autoOn}
                onChange={(v) => onParamChange(spec.key, v)}
                onDragStart={onParamDragStart}
                formatValue={spec.key === "makeup" && autoOn ? (v) => `Auto ${v >= 0 ? "+" : ""}${v.toFixed(1)}dB` : spec.format}
              />
            ))}
          </div>
        </div>

        <div style={{ height: 1, background: "#2E2F37" }} />

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              onParamDragStart?.();
              onParamChange("makeupAuto", autoOn ? 0 : 1);
            }}
            className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide"
            style={{
              background: autoOn ? "rgba(230,173,94,0.14)" : "#23242B",
              border: `1px solid ${autoOn ? "#E6AD5E" : "#2E2F37"}`,
              color: autoOn ? "#E6AD5E" : "#6E6E78",
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: autoOn ? "#E6AD5E" : "#5A5B64" }} />
            Auto Makeup
          </button>
          <span className="text-[10px] text-muted">Drag · click or right-click to type · double-click to reset</span>
        </div>
      </div>
    </div>
  );
}
