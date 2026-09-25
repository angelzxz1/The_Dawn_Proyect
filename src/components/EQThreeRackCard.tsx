"use client";

import { Maximize2, Power, X } from "lucide-react";
import { EQThreeKnob } from "./EQThreeKnob";
import { EQThreeIcon } from "./EQThreeIcon";
import { paramSpecs } from "@/lib/effects";
import { fraunces, spaceGrotesk } from "@/lib/eqThreeFonts";

interface EQThreeRackCardProps {
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onRemove: () => void;
  onExpand: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}

/** The compact card shown inline in the FX rack - just the knobs, no
 * numeric readouts (matching the design's compact view), with a button to
 * open the full EQThreeWindow for the graph and readouts. */
export function EQThreeRackCard({
  params,
  bypass,
  onBypassToggle,
  onRemove,
  onExpand,
  onParamChange,
  onParamDragStart,
}: EQThreeRackCardProps) {
  const specs = paramSpecs("eq3");
  const gainSpecs = specs.slice(0, 3); // low, mid, high
  const xoverSpecs = specs.slice(3); // lowFrequency, highFrequency

  return (
    <div className="flex h-full flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <EQThreeIcon size={15} />
          <h2 className={`${fraunces.className} text-[13px] font-semibold text-[#F4EDE2]`}>EQ Three</h2>
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
        {gainSpecs.map((spec) => (
          <EQThreeKnob
            key={spec.key}
            label={spec.label}
            value={params[spec.key] ?? spec.default}
            min={spec.min}
            max={spec.max}
            defaultValue={spec.default}
            mode="bipolar"
            size={34}
            onChange={(v) => onParamChange(spec.key, v)}
            onDragStart={onParamDragStart}
            formatValue={spec.format}
          />
        ))}
      </div>

      <div style={{ height: 1, background: "#2E2F37" }} />

      <div className={`${spaceGrotesk.className} grid grid-cols-2 gap-1`}>
        {xoverSpecs.map((spec) => (
          <EQThreeKnob
            key={spec.key}
            label={spec.label}
            value={params[spec.key] ?? spec.default}
            min={spec.min}
            max={spec.max}
            defaultValue={spec.default}
            mode="log"
            size={30}
            onChange={(v) => onParamChange(spec.key, v)}
            onDragStart={onParamDragStart}
            formatValue={spec.format}
          />
        ))}
      </div>
    </div>
  );
}
