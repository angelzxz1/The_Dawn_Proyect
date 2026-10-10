// What every instrument's rack card and window are given. Each folder's
// ui.tsx hands its own settings from these to its components.

import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { InstrumentSettings } from "../types";
import type { TrackColor } from "../../project/colors";

export interface InstrumentCardProps {
  /** The track it's on (none where there's nothing live to play). */
  channelId?: string;
  /** The track's settings; the card reads its own. */
  settings: InstrumentSettings;
  /** Takes only the settings that changed. */
  onSettingsChange?: (settings: InstrumentSettings) => void;
  /** Fired once at the start of each edit gesture (one undo step each). */
  onDragStart?: () => void;
  onOpen?: () => void;
}

export interface InstrumentWindowProps {
  channelId: string;
  /** The track's name, shown in the title. */
  channelName: string;
  color: TrackColor;
  settings: InstrumentSettings;
  onSettingsChange: (settings: InstrumentSettings) => void;
  onDragStart?: () => void;
  onClose: () => void;
}

export interface InstrumentUi {
  /** Its button in the FX rack's instrument picker. */
  icon: LucideIcon;
  /** The instrument slot's width in the FX rack (a Tailwind class). */
  slotWidth: "w-56" | "w-[262px]";
  RackCard?: ComponentType<InstrumentCardProps>;
  Window?: ComponentType<InstrumentWindowProps>;
}
