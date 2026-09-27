"use client";

import { Maximize2, Power, X } from "lucide-react";
import { PluginIcon } from "./PluginIcon";
import { PluginKnob } from "./PluginKnob";
import { MultibandGraph } from "./MultibandGraph";
import { paramSpecs } from "@/lib/effects";
import { mbBandCount } from "@/lib/multibandModel";
import { fraunces, spaceGrotesk } from "@/lib/pluginFonts";

interface MultibandRackCardProps {
  hostId?: string;
  effectId: string;
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onRemove: () => void;
  onExpand: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}

/** The compact card in the FX rack: the bands with their live gain (click
 * to open the full window), and mix/output. */
export function MultibandRackCard({ hostId, effectId, params, bypass, onBypassToggle, onRemove, onExpand, onParamChange, onParamDragStart }: MultibandRackCardProps) {
  const count = mbBandCount(params);
  const specs = paramSpecs("multiband");
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <PluginIcon size={15} />
          <h2 className={`${fraunces.className} text-[13px] font-semibold text-[#F4EDE2]`}>Multiband</h2>
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
        <button type="button" onClick={onExpand} title="Open the multiband" className="min-w-0 flex-1">
          <MultibandGraph params={params} width={240} height={112} compact hostId={hostId} effectId={effectId} />
        </button>
        <div className={`${spaceGrotesk.className} flex flex-col`}>
          {(["mix", "output"] as const).map((key) => {
            const s = specs.find((p) => p.key === key)!;
            return (
              <PluginKnob
                key={key}
                label={s.label}
                value={params[key] ?? s.default}
                min={s.min}
                max={s.max}
                defaultValue={s.default}
                mode={key === "output" ? "bipolar" : "linear"}
                size={22}
                onChange={(v) => onParamChange(key, v)}
                onDragStart={onParamDragStart}
                formatValue={s.format}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
