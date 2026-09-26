"use client";

import { Maximize2, Power, X } from "lucide-react";
import { PluginKnob } from "./PluginKnob";
import { PluginIcon } from "./PluginIcon";
import { paramSpecs } from "@/lib/effects";
import { formatDivision } from "@/lib/delayDivisions";
import { fraunces, spaceGrotesk } from "@/lib/pluginFonts";

interface DelayRackCardProps {
  params: Record<string, number>;
  bpm: number;
  bypass: boolean;
  onBypassToggle: () => void;
  onRemove: () => void;
  onExpand: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}

/** The compact card shown inline in the FX rack - the six knobs that shape
 * the sound (Time L/R, Feedback, Low/High Cut, Dry/Wet); Sync/Link/Ping-
 * Pong/Freeze/Filter live in the full DelayWindow, opened via expand. */
export function DelayRackCard({
  params,
  bpm,
  bypass,
  onBypassToggle,
  onRemove,
  onExpand,
  onParamChange,
  onParamDragStart,
}: DelayRackCardProps) {
  const [timeLSpec, timeRSpec, feedbackSpec, lowCutSpec, highCutSpec, wetSpec] = paramSpecs("delay");
  const syncOn = (params.sync ?? 1) >= 0.5;
  const linkOn = (params.link ?? 0) >= 0.5;

  const timeFormat = (v: number) => (syncOn ? formatDivision(v, bpm) : timeLSpec.format(v));

  return (
    <div className="flex h-full flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <PluginIcon size={15} />
          <h2 className={`${fraunces.className} text-[13px] font-semibold text-[#F4EDE2]`}>Delay</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Expand"
            onClick={onExpand}
            className="flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-black/20"
          >
            <Maximize2 size={11} />
          </button>
          <button
            type="button"
            title={bypass ? "Enable effect" : "Bypass effect"}
            onClick={onBypassToggle}
            className="flex h-5 w-5 items-center justify-center rounded"
            style={{ background: "#23242B", border: "1px solid #2E2F37" }}
          >
            <Power size={11} color={bypass ? "#5A5B64" : "#E6AD5E"} />
          </button>
          <button
            type="button"
            title="Remove effect"
            onClick={onRemove}
            className="flex h-5 w-5 items-center justify-center rounded text-record hover:bg-black/20"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      <div className={`${spaceGrotesk.className} grid grid-cols-3 gap-1`}>
        <PluginKnob
          label={timeLSpec.label}
          value={params.delayTimeL ?? timeLSpec.default}
          min={timeLSpec.min}
          max={timeLSpec.max}
          defaultValue={timeLSpec.default}
          mode="log"
          size={34}
          onChange={(v) => onParamChange("delayTimeL", v)}
          onDragStart={onParamDragStart}
          formatValue={timeFormat}
        />
        <PluginKnob
          label={timeRSpec.label}
          value={linkOn ? params.delayTimeL ?? timeLSpec.default : params.delayTimeR ?? timeRSpec.default}
          min={timeRSpec.min}
          max={timeRSpec.max}
          defaultValue={timeRSpec.default}
          mode="log"
          size={34}
          disabled={linkOn}
          onChange={(v) => onParamChange("delayTimeR", v)}
          onDragStart={onParamDragStart}
          formatValue={timeFormat}
        />
        <PluginKnob
          label={feedbackSpec.label}
          value={params[feedbackSpec.key] ?? feedbackSpec.default}
          min={feedbackSpec.min}
          max={feedbackSpec.max}
          defaultValue={feedbackSpec.default}
          mode="linear"
          size={34}
          onChange={(v) => onParamChange(feedbackSpec.key, v)}
          onDragStart={onParamDragStart}
          formatValue={feedbackSpec.format}
        />
      </div>

      <div className={`${spaceGrotesk.className} grid grid-cols-3 gap-1`}>
        {[lowCutSpec, highCutSpec, wetSpec].map((spec) => (
          <PluginKnob
            key={spec.key}
            label={spec.label}
            value={params[spec.key] ?? spec.default}
            min={spec.min}
            max={spec.max}
            defaultValue={spec.default}
            mode={spec.key === "wet" ? "linear" : "log"}
            size={34}
            onChange={(v) => onParamChange(spec.key, v)}
            onDragStart={onParamDragStart}
            formatValue={spec.format}
          />
        ))}
      </div>
    </div>
  );
}
