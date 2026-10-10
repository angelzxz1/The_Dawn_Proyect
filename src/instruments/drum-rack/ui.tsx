import { useCallback } from "react";
import { Drum } from "lucide-react";
import type { InstrumentCardProps, InstrumentUi, InstrumentWindowProps } from "@/instruments/ui/types";
import type { DrumKitParams } from "./drumParams";
import { DrumRackCard } from "./DrumRackCard";
import { DrumRackWindow } from "./DrumRackWindow";

function TrackCard({ channelId, settings, onOpen }: InstrumentCardProps) {
  return settings.drumParams ? <DrumRackCard channelId={channelId} kit={settings.drumParams} onOpen={onOpen} /> : null;
}

function TrackWindow({ channelId, channelName, settings, onSettingsChange, onDragStart, onClose }: InstrumentWindowProps) {
  const onChange = useCallback((drumParams: DrumKitParams) => onSettingsChange({ drumParams }), [onSettingsChange]);
  if (!settings.drumParams) return null;
  return (
    <DrumRackWindow
      channelId={channelId}
      channelName={channelName}
      kit={settings.drumParams}
      onChange={onChange}
      onClose={onClose}
      onDragStart={onDragStart}
    />
  );
}

export const drumRackUi: InstrumentUi = { icon: Drum, slotWidth: "w-[262px]", RackCard: TrackCard, Window: TrackWindow };
