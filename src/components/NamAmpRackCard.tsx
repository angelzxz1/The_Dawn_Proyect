"use client";

import { Maximize2, Power, X } from "lucide-react";
import { PluginKnob } from "./PluginKnob";
import { PluginIcon } from "./PluginIcon";
import { NamFileSlot, useNamModel } from "./NamFileSlot";
import { NAM_AMP_KNOBS, namAmpParam, namAmpSpec } from "./NamAmpWindow";
import type { EffectFileRef } from "@/lib/effects";
import { fraunces, spaceGrotesk } from "@/lib/pluginFonts";

interface NamAmpRackCardProps {
  params: Record<string, number>;
  file: EffectFileRef | undefined;
  bypass: boolean;
  onBypassToggle: () => void;
  onRemove: () => void;
  onExpand: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
  onLoadFile: (file: File) => Promise<string | null>;
  onClearFile: () => void;
}

/** The compact card shown inline in the FX rack - the model slot and the
 * five knobs; the model details, tone-stack curve, input meter and the
 * Normalize/Size switches live in the full NamAmpWindow, opened via expand. */
export function NamAmpRackCard({
  params,
  file,
  bypass,
  onBypassToggle,
  onRemove,
  onExpand,
  onParamChange,
  onParamDragStart,
  onLoadFile,
  onClearFile,
}: NamAmpRackCardProps) {
  const model = useNamModel(file);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <PluginIcon size={15} />
          <h2 className={`${fraunces.className} text-[13px] font-semibold text-[#F4EDE2]`}>NAM Amp</h2>
          {model.status === "ready" && model.info.isA2 && (
            <span className={`${spaceGrotesk.className} text-[10px] font-semibold uppercase tracking-wider text-muted`}>
              A2 {namAmpParam(params, "size") >= 0.5 ? "Full" : "Lite"}
            </span>
          )}
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

      <div className={spaceGrotesk.className}>
        <NamFileSlot file={file} model={model} onLoad={onLoadFile} onClear={onClearFile} compact />
      </div>

      <div className={`${spaceGrotesk.className} grid grid-cols-5 gap-x-0.5`}>
        {NAM_AMP_KNOBS.map(({ key, mode }) => {
          const spec = namAmpSpec(key);
          return (
            <PluginKnob
              key={key}
              label={spec.label}
              value={namAmpParam(params, key)}
              min={spec.min}
              max={spec.max}
              defaultValue={spec.default}
              mode={mode}
              size={30}
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
