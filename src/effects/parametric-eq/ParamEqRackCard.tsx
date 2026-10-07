"use client";

import { useMemo } from "react";
import { Maximize2, Power, X } from "lucide-react";
import { PluginIcon } from "@/effects/ui/PluginIcon";
import { PluginKnob } from "@/effects/ui/PluginKnob";
import { ParamEqGraph } from "./ParamEqGraph";
import { paramSpecs } from "@/effects/registry";
import { eqBandsFromParams } from "./paramEqModel";
import { fraunces, spaceGrotesk } from "@/effects/ui/pluginFonts";

interface ParamEqRackCardProps {
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onRemove: () => void;
  onExpand: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}

/** The compact card in the FX rack: a live preview of the curve (click it to
 * open the full EQ) and the output gain. */
export function ParamEqRackCard({ params, bypass, onBypassToggle, onRemove, onExpand, onParamChange, onParamDragStart }: ParamEqRackCardProps) {
  const count = useMemo(() => eqBandsFromParams(params).filter((b) => b.on !== 0).length, [params]);
  const output = paramSpecs("paramEq").find((s) => s.key === "output")!;
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <PluginIcon size={15} />
          <h2 className={`${fraunces.className} text-[13px] font-semibold text-[#F4EDE2]`}>Parametric EQ</h2>
          <span className={`${spaceGrotesk.className} text-[10px] font-semibold uppercase tracking-wider text-muted`}>
            {count} {count === 1 ? "band" : "bands"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" title="Expand" onClick={onExpand} className="flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-black/20">
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
          <button type="button" title="Remove effect" onClick={onRemove} className="flex h-5 w-5 items-center justify-center rounded text-record hover:bg-black/20">
            <X size={11} />
          </button>
        </div>
      </div>
      <div className="flex flex-1 items-center gap-2">
        <button type="button" onClick={onExpand} title="Open the EQ" className="min-w-0 flex-1">
          <ParamEqGraph params={params} width={260} height={112} compact />
        </button>
        <div className={spaceGrotesk.className}>
          <PluginKnob
            label="Output"
            value={params.output ?? 0}
            min={output.min}
            max={output.max}
            defaultValue={0}
            mode="bipolar"
            size={30}
            onChange={(v) => onParamChange("output", v)}
            onDragStart={onParamDragStart}
            formatValue={output.format}
          />
        </div>
      </div>
    </div>
  );
}
