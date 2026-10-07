"use client";

import { RackCardHeader, PluginToggle } from "@/effects/ui/PluginChrome";
import { tuneColor, useTuner } from "./TunerDisplay";
import { spaceGrotesk } from "@/effects/ui/pluginFonts";

interface TunerRackCardProps {
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

/** The compact Tuner in the FX rack: the note, a cents bar, the
 * frequency, and Mute. */
export function TunerRackCard({ hostId, effectId, params, bypass, onBypassToggle, onRemove, onExpand, onParamChange, onParamDragStart }: TunerRackCardProps) {
  const reference = params.reference ?? 440;
  const muted = (params.mute ?? 0) >= 0.5;
  const { note } = useTuner(bypass ? undefined : hostId, effectId, reference, (params.flats ?? 0) >= 0.5);
  const cents = note ? Math.max(-50, Math.min(50, note.cents)) : 0;
  const color = note ? tuneColor(note.cents) : "#3A3B44";
  return (
    <div className={`${spaceGrotesk.className} flex h-full flex-col gap-2`}>
      <RackCardHeader title="Tuner" status={`A ${reference.toFixed(0)}`} bypass={bypass} onBypassToggle={onBypassToggle} onRemove={onRemove} onExpand={onExpand} />
      <button type="button" onClick={onExpand} title="Open the tuner" className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-lg" style={{ background: "#14151A" }}>
        <span className="text-[30px] font-bold leading-none" style={{ color: note ? "#F4EDE2" : "#4A4B55" }}>
          {note ? note.name : "–"}
          {note && <span className="ml-0.5 text-[13px] text-muted">{note.octave}</span>}
        </span>
        <div className="relative h-2 w-44 rounded-full" style={{ background: "#23242B" }}>
          <div className="absolute top-0 h-full w-px" style={{ left: "50%", background: "#5A5B64" }} />
          <div className="absolute top-[-3px] h-[14px] w-1 rounded-full" style={{ left: `calc(${50 + cents}% - 2px)`, background: color, transition: "left 80ms linear" }} />
        </div>
        <span className="font-mono text-[10.5px]" style={{ color: note ? color : "#5A5B64" }}>
          {note ? `${note.cents > 0 ? "+" : ""}${note.cents.toFixed(1)} ct · ${note.freq.toFixed(1)} Hz` : bypass ? "bypassed" : "no signal"}
        </span>
      </button>
      <div className="flex justify-end">
        <PluginToggle
          label="Mute"
          small
          danger
          active={muted}
          title="Silence the track's output while tuning"
          onClick={() => {
            onParamDragStart?.();
            onParamChange("mute", muted ? 0 : 1);
          }}
        />
      </div>
    </div>
  );
}
