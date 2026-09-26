"use client";

import { Maximize2, Power, X } from "lucide-react";
import { PluginKnob } from "./PluginKnob";
import { PluginIcon } from "./PluginIcon";
import { REVERB_KNOB_KEYS, REVERB_KNOB_MODES, reverbSpec } from "./ReverbWindow";
import { reverbModeFromParam } from "@/lib/reverbModel";
import { fraunces, spaceGrotesk } from "@/lib/pluginFonts";

interface ReverbRackCardProps {
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onRemove: () => void;
  onExpand: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}

/** The compact card shown inline in the FX rack - all eight knobs; the
 * response graph and Hall/Room/Plate selector live in the full
 * ReverbWindow, opened via expand. */
export function ReverbRackCard({
  params,
  bypass,
  onBypassToggle,
  onRemove,
  onExpand,
  onParamChange,
  onParamDragStart,
}: ReverbRackCardProps) {
  const mode = reverbModeFromParam(params.mode ?? reverbSpec("mode").default);

  return (
    <div className="flex h-full flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <PluginIcon size={15} />
          <h2 className={`${fraunces.className} text-[13px] font-semibold text-[#F4EDE2]`}>Reverb</h2>
          <span className={`${spaceGrotesk.className} text-[10px] font-semibold uppercase tracking-wider text-muted`}>
            {mode}
          </span>
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

      <div className={`${spaceGrotesk.className} grid grid-cols-4 gap-x-1 gap-y-2`}>
        {REVERB_KNOB_KEYS.map((key) => {
          const spec = reverbSpec(key);
          return (
            <PluginKnob
              key={key}
              label={spec.label}
              value={params[key] ?? spec.default}
              min={spec.min}
              max={spec.max}
              defaultValue={spec.default}
              mode={REVERB_KNOB_MODES[key]}
              size={32}
              onChange={(v) => onParamChange(key, v)}
              onDragStart={onParamDragStart}
              formatValue={spec.format}
            />
          );
        })}
      </div>
    </div>
  );
}
