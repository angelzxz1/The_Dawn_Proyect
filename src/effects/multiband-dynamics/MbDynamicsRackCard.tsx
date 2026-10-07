"use client";

import { PluginKnob } from "@/effects/ui/PluginKnob";
import { RackCardHeader } from "@/effects/ui/PluginChrome";
import { SidechainBadge } from "@/effects/sidechain/SidechainPanel";
import { MbDynamicsDisplay, useMbdMeters } from "./MbDynamicsDisplay";
import { mbdSpec, mbdValue } from "./MbDynamicsWindow";
import { mbdActiveBands, mbdSettingsFromParams } from "./mbDynamicsModel";
import { spaceGrotesk } from "@/effects/ui/pluginFonts";

/** The compact Multiband Dynamics in the FX rack: a small read-only
 * display and Amount, Time and Output. */
export function MbDynamicsRackCard({
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
  const meters = useMbdMeters(bypass ? undefined : hostId, effectId);
  const bands = mbdActiveBands(mbdSettingsFromParams(params)).length;
  return (
    <div className={`${spaceGrotesk.className} flex h-full flex-col gap-2`}>
      <RackCardHeader
        title="MB Dynamics"
        status={
          <span className="flex items-center gap-1.5">
            {bands} {bands === 1 ? "band" : "bands"}
            <SidechainBadge name={sidechainName ?? null} />
          </span>
        }
        bypass={bypass}
        onBypassToggle={onBypassToggle}
        onRemove={onRemove}
        onExpand={onExpand}
      />
      <button type="button" onClick={onExpand} title="Open Multiband Dynamics" className="block w-full">
        <MbDynamicsDisplay params={params} meters={meters} width={300} rowHeight={30} interactive={false} />
      </button>
      <div className="flex items-center justify-between">
        {(["amount", "time", "output"] as const).map((key) => {
          const s = mbdSpec(key);
          return (
            <PluginKnob
              key={key}
              label={s.label}
              value={mbdValue(params, key)}
              min={s.min}
              max={s.max}
              defaultValue={s.default}
              mode={key === "output" ? "bipolar" : key === "time" ? "log" : "linear"}
              size={22}
              layout="inline"
              onChange={(v) => onParamChange(key, v)}
              onDragStart={onParamDragStart}
              formatValue={s.format}
            />
          );
        })}
      </div>
    </div>
  );
}
