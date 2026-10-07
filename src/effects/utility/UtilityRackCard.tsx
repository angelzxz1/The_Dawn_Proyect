"use client";

import { PluginKnob } from "@/effects/ui/PluginKnob";
import { PluginToggle, RackCardHeader } from "@/effects/ui/PluginChrome";
import { UTILITY_KNOBS, UTILITY_TOGGLES, utilitySpec, utilityValue } from "./UtilityWindow";
import { spaceGrotesk } from "@/effects/ui/pluginFonts";

interface UtilityRackCardProps {
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onRemove: () => void;
  onExpand: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}

/** The compact Utility in the FX rack: gain, width, balance and the
 * toggles; the meters and scope are in the full window. */
export function UtilityRackCard({ params, bypass, onBypassToggle, onRemove, onExpand, onParamChange, onParamDragStart }: UtilityRackCardProps) {
  const value = (key: string) => utilityValue(params, key);
  return (
    <div className={`${spaceGrotesk.className} flex h-full flex-col gap-2`}>
      <RackCardHeader title="Utility" status={utilitySpec("gain").format(value("gain"))} bypass={bypass} onBypassToggle={onBypassToggle} onRemove={onRemove} onExpand={onExpand} />
      <div className="grid grid-cols-3 gap-x-1">
        {UTILITY_KNOBS.map(({ key, mode }) => {
          const s = utilitySpec(key);
          return (
            <PluginKnob
              key={key}
              label={s.label}
              value={value(key)}
              min={s.min}
              max={s.max}
              defaultValue={s.default}
              mode={mode}
              size={34}
              disabled={key === "width" && value("mono") >= 0.5}
              onChange={(v) => onParamChange(key, v)}
              onDragStart={onParamDragStart}
              formatValue={s.format}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap justify-center gap-1">
        {UTILITY_TOGGLES.map((t) => (
          <PluginToggle
            key={t.key}
            small
            label={t.label}
            title={t.title}
            danger={t.danger}
            active={value(t.key) >= 0.5}
            onClick={() => {
              onParamDragStart?.();
              onParamChange(t.key, value(t.key) >= 0.5 ? 0 : 1);
            }}
          />
        ))}
      </div>
    </div>
  );
}
