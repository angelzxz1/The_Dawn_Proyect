"use client";

import { Maximize2 } from "lucide-react";
import { audioEngine } from "@/engine/audioEngine";
import type { DrumKitParams } from "./drumParams";
import { fraunces, spaceGrotesk } from "@/effects/ui/pluginFonts";
import { padColor } from "./DrumRackWindow";

/** The Drum Rack in the FX rack: its kit and 16 mini pads to try. */
export function DrumRackCard({ channelId, kit, onOpen }: { channelId?: string; kit: DrumKitParams; onOpen?: () => void }) {
  const order = [12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3];
  return (
    <div className={`${spaceGrotesk.className} flex flex-1 flex-col gap-1.5`}>
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className={`${fraunces.className} text-[14px] font-semibold text-[#F4EDE2]`}>Drum Rack</span>
          <span className="truncate text-[11px] text-muted">{kit.kit ?? "Custom"}</span>
        </div>
        <button type="button" title="Open the Drum Rack" onClick={onOpen} className="flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-black/20">
          <Maximize2 size={11} />
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {order.map((i) => {
          const p = kit.pads[i];
          return (
            <button
              key={i}
              type="button"
              title={`${p.name} - click to hear it`}
              onPointerDown={() => channelId && audioEngine.auditionDrumPad(channelId, i)}
              onDoubleClick={onOpen}
              className="h-[22px] truncate rounded px-1 text-left text-[9px] font-medium text-[#F4EDE2] hover:brightness-125"
              style={{ background: "#24252F", borderLeft: `3px solid ${padColor(p)}`, opacity: p.mute ? 0.4 : 1 }}
            >
              {p.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
