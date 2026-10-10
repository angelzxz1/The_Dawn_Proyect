"use client";

import { Maximize2, Power, X } from "lucide-react";
import { PluginKnob } from "@/ui/PluginKnob";
import { PluginIcon } from "@/effects/ui/PluginIcon";
import { GATE_KNOBS, gateParam, gateSpec } from "./GateWindow";
import { SidechainBadge } from "@/effects/sidechain/SidechainPanel";
import { fraunces, spaceGrotesk } from "@/ui/pluginFonts";

interface GateRackCardProps {
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onRemove: () => void;
  onExpand: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
  /** The sidechain source's name, when one is keying it. */
  sidechainName?: string | null;
}

/** The compact card shown inline in the FX rack - all five knobs; the level
 * history graph lives in the full GateWindow, opened via expand. */
export function GateRackCard({
  params,
  bypass,
  onBypassToggle,
  onRemove,
  onExpand,
  onParamChange,
  onParamDragStart,
  sidechainName,
}: GateRackCardProps) {
  return (
    <div className="flex h-full flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <PluginIcon size={15} />
          <h2 className={`${fraunces.className} text-[13px] font-semibold text-[#F4EDE2]`}>Noise Gate</h2>
          <SidechainBadge name={sidechainName ?? null} />
          <span className={`${spaceGrotesk.className} text-[10px] font-semibold uppercase tracking-wider text-muted`}>
            {gateSpec("threshold").format(gateParam(params, "threshold"))}
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

      <div className={`${spaceGrotesk.className} grid grid-cols-3 gap-x-1 gap-y-2`}>
        {GATE_KNOBS.map(({ key, mode }) => {
          const spec = gateSpec(key);
          return (
            <PluginKnob
              key={key}
              label={spec.label}
              value={gateParam(params, key)}
              min={spec.min}
              max={spec.max}
              defaultValue={spec.default}
              mode={mode}
              size={34}
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
