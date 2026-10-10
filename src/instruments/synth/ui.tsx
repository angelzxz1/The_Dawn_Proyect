import { useCallback } from "react";
import { Waves } from "lucide-react";
import type { InstrumentCardProps, InstrumentUi, InstrumentWindowProps } from "@/instruments/ui/types";
import type { SynthParams } from "./synthParams";
import { SynthRackCard } from "./SynthRackCard";
import { SynthWindow } from "./SynthWindow";

function TrackCard({ settings, onSettingsChange, onDragStart, onOpen }: InstrumentCardProps) {
  const onChange = useCallback((synthParams: SynthParams) => onSettingsChange?.({ synthParams }), [onSettingsChange]);
  if (!settings.synthParams) return null;
  return (
    <SynthRackCard
      params={settings.synthParams}
      onChange={onSettingsChange ? onChange : undefined}
      onDragStart={onDragStart}
      onOpen={onOpen}
    />
  );
}

function TrackWindow({ channelId, channelName, color, settings, onSettingsChange, onDragStart, onClose }: InstrumentWindowProps) {
  const onChange = useCallback((synthParams: SynthParams) => onSettingsChange({ synthParams }), [onSettingsChange]);
  if (!settings.synthParams) return null;
  return (
    <SynthWindow
      channelId={channelId}
      channelName={channelName}
      color={color}
      params={settings.synthParams}
      onChange={onChange}
      onClose={onClose}
      onDragStart={onDragStart}
    />
  );
}

export const synthUi: InstrumentUi = { icon: Waves, slotWidth: "w-[262px]", RackCard: TrackCard, Window: TrackWindow };
