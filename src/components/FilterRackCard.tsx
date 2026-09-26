"use client";

import { Maximize2, Power, X } from "lucide-react";
import { PluginKnob } from "./PluginKnob";
import { PluginIcon } from "./PluginIcon";
import { FILTER_KNOBS, filterParam, filterSpec } from "./FilterWindow";
import {
  FILTER_MODES,
  FILTER_SLOPES,
  filterModeFromParam,
  filterUsesGain,
  filterUsesSlope,
  slopeIndexFromParam,
} from "@/lib/filterModel";
import { fraunces, spaceGrotesk } from "@/lib/pluginFonts";

interface FilterRackCardProps {
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onRemove: () => void;
  onExpand: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}

/** The compact card shown inline in the FX rack - all six knobs, with the
 * current type/slope in the header; the response graph and the type/slope
 * selectors live in the full FilterWindow, opened via expand. */
export function FilterRackCard({
  params,
  bypass,
  onBypassToggle,
  onRemove,
  onExpand,
  onParamChange,
  onParamDragStart,
}: FilterRackCardProps) {
  const mode = filterModeFromParam(filterParam(params, "mode"));
  const label = FILTER_MODES.find((m) => m.mode === mode)!.label;
  const slope = FILTER_SLOPES[slopeIndexFromParam(filterParam(params, "slope"))];

  return (
    <div className="flex h-full flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <PluginIcon size={15} />
          <h2 className={`${fraunces.className} text-[13px] font-semibold text-[#F4EDE2]`}>Filter</h2>
          <span className={`${spaceGrotesk.className} text-[10px] font-semibold uppercase tracking-wider text-muted`}>
            {label}
            {filterUsesSlope(mode) ? ` ${slope}` : ""}
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
        {FILTER_KNOBS.map(({ key, mode: knobMode }) => {
          const spec = filterSpec(key);
          return (
            <PluginKnob
              key={key}
              label={spec.label}
              value={filterParam(params, key)}
              min={spec.min}
              max={spec.max}
              defaultValue={spec.default}
              mode={knobMode}
              size={34}
              disabled={key === "gain" && !filterUsesGain(mode)}
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
