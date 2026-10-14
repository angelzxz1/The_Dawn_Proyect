// What every effect's rack card and window are given. Each effect's
// components take whichever of these they need (see each folder's ui.ts).

import type { ComponentType } from "react";
import type { EffectFileRef } from "../types";
import type { SidechainRouting } from "../sidechain/sidechainModel";
import type { SidechainSource } from "../sidechain/SidechainPanel";

export interface EffectCardProps {
  /** The track, bus or "master" the effect is on (for live meters; none
   * where there's nothing live to show). */
  hostId?: string;
  effectId: string;
  params: Record<string, number>;
  bypass: boolean;
  bpm: number;
  file: EffectFileRef | undefined;
  /** The track keying its sidechain, if any. */
  sidechainName: string | null;
  onBypassToggle: () => void;
  onRemove: () => void;
  onExpand: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
  onLoadFile: (file: File) => Promise<string | null>;
  onClearFile: () => void;
}

export interface EffectWindowProps {
  hostId: string;
  effectId: string;
  /** The track, bus or master's name, shown in the title. */
  channelName: string;
  params: Record<string, number>;
  bypass: boolean;
  bpm: number;
  file: EffectFileRef | undefined;
  sidechain?: SidechainRouting;
  /** Tracks and buses that can key its sidechain. */
  sidechainSources: SidechainSource[];
  onBypassToggle: () => void;
  onClose: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
  onSidechainChange: (routing: SidechainRouting) => void;
  onLoadFile: (file: File) => Promise<string | null>;
  onClearFile: () => void;
  /** Loads one of Dawn's own files (a cabinet, a tone) by reference. */
  onPickFile: (ref: EffectFileRef) => void;
}

export interface EffectUi {
  /** The rack card's width (a Tailwind class). */
  cardWidth: "w-64" | "w-72" | "w-80";
  RackCard: ComponentType<EffectCardProps>;
  Window: ComponentType<EffectWindowProps>;
}
