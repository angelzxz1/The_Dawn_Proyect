"use client";

import { Maximize2, Power, X } from "lucide-react";
import { PluginKnob } from "@/ui/PluginKnob";
import { PluginIcon } from "@/effects/ui/PluginIcon";
import { IrFileSlot, useImpulseResponse } from "./IrFileSlot";
import { IR_LOADER_KNOBS, irLoaderParam, irLoaderSpec } from "./IrLoaderWindow";
import type { EffectFileRef } from "@/effects/registry";
import { fraunces, spaceGrotesk } from "@/ui/pluginFonts";

interface IrLoaderRackCardProps {
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

/** The compact card shown inline in the FX rack - the file slot and the four
 * knobs; the response graph and Normalize live in the full IrLoaderWindow,
 * opened via expand. */
export function IrLoaderRackCard({
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
}: IrLoaderRackCardProps) {
  const impulse = useImpulseResponse(file);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <PluginIcon size={15} />
          <h2 className={`${fraunces.className} text-[13px] font-semibold text-[#F4EDE2]`}>IR Loader</h2>
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
        <IrFileSlot file={file} impulse={impulse} onLoad={onLoadFile} onClear={onClearFile} compact />
      </div>

      <div className={`${spaceGrotesk.className} grid grid-cols-4 gap-x-1`}>
        {IR_LOADER_KNOBS.map(({ key, mode }) => {
          const spec = irLoaderSpec(key);
          return (
            <PluginKnob
              key={key}
              label={spec.label}
              value={irLoaderParam(params, key)}
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
