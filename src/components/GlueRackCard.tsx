"use client";

import { PluginKnob } from "./PluginKnob";
import { RackCardHeader } from "./PluginChrome";
import { SidechainBadge } from "./SidechainPanel";
import { GLUE_STEPPED, GlueNeedle, glueSpec, glueValue } from "./GlueWindow";
import { spaceGrotesk } from "@/lib/pluginFonts";

const CARD_KNOBS = ["threshold", "ratio", "attack", "release"];

/** The compact Glue Compressor in the FX rack: a small needle meter and
 * the four main knobs (Makeup and the rest are in the window). */
export function GlueRackCard({
  hostId,
  effectId,
  params,
  bypass,
  sidechainName,
  onBypassToggle,
  onRemove,
  onExpand,
  onParamChange,
  onParamDragStart,
}: {
  hostId?: string;
  effectId: string;
  params: Record<string, number>;
  bypass: boolean;
  sidechainName?: string | null;
  onBypassToggle: () => void;
  onRemove: () => void;
  onExpand: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}) {
  return (
    <div className={`${spaceGrotesk.className} flex h-full flex-col gap-2`}>
      <RackCardHeader
        title="Glue"
        status={
          <span className="flex items-center gap-1.5">
            {glueSpec("ratio").format(glueValue(params, "ratio"))}
            <SidechainBadge name={sidechainName ?? null} />
          </span>
        }
        bypass={bypass}
        onBypassToggle={onBypassToggle}
        onRemove={onRemove}
        onExpand={onExpand}
      />
      <div className="flex items-center gap-2">
        <button type="button" onClick={onExpand} title="Open the Glue Compressor" className="shrink-0">
          <GlueNeedle hostId={bypass ? undefined : hostId} effectId={effectId} width={104} />
        </button>
        <div className="grid flex-1 grid-cols-2 gap-x-1 gap-y-1.5">
          {CARD_KNOBS.map((key) => {
            const spec = glueSpec(key);
            return (
              <PluginKnob
                key={key}
                label={spec.label}
                value={glueValue(params, key)}
                min={spec.min}
                max={spec.max}
                defaultValue={spec.default}
                mode="linear"
                size={28}
                onChange={(v) => onParamChange(key, GLUE_STEPPED.has(key) ? Math.round(v) : v)}
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
