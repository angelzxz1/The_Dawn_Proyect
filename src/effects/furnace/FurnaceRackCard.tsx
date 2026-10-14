"use client";

import { PluginKnob } from "@/ui/PluginKnob";
import { RackCardHeader } from "@/effects/ui/PluginChrome";
import { FurnaceCurve, furnaceSpec, furnaceValue } from "./FurnaceWindow";
import { AMP_MODE_LABELS, AMP_RECTIFIER_LABELS, ampMode, ampRectifier } from "./ampModel";
import { spaceGrotesk } from "@/ui/pluginFonts";

const CARD_KNOBS = ["gain", "bass", "mid", "treble"];

/** The compact Furnace amp in the FX rack: the tone curve and the four
 * main knobs (Presence, Master, Output and the switches are in the window). */
export function FurnaceRackCard({
  params,
  bypass,
  onBypassToggle,
  onRemove,
  onExpand,
  onParamChange,
  onParamDragStart,
}: {
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onRemove: () => void;
  onExpand: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}) {
  const status = `${AMP_MODE_LABELS[ampMode(params.mode)]} · ${AMP_RECTIFIER_LABELS[ampRectifier(params.rectifier)]}`;
  return (
    <div className={`${spaceGrotesk.className} flex h-full flex-col gap-2`}>
      <RackCardHeader title="Furnace" status={status} bypass={bypass} onBypassToggle={onBypassToggle} onRemove={onRemove} onExpand={onExpand} />
      <div className="flex items-center gap-2">
        <button type="button" onClick={onExpand} title="Open the Furnace" className="shrink-0">
          <FurnaceCurve params={params} width={104} height={72} />
        </button>
        <div className="grid flex-1 grid-cols-2 gap-x-1 gap-y-1.5">
          {CARD_KNOBS.map((key) => {
            const spec = furnaceSpec(key);
            return (
              <PluginKnob
                key={key}
                label={spec.label}
                value={furnaceValue(params, key)}
                min={spec.min}
                max={spec.max}
                defaultValue={spec.default}
                mode="linear"
                size={28}
                onChange={(v) => onParamChange(key, v)}
                onDragStart={onParamDragStart}
                formatValue={spec.format}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
