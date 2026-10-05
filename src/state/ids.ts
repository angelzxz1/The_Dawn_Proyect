// New ids for tracks, clips, buses and automation lanes ("ch-3", "clip-12",
// ...), and a new track's defaults.

import type { ChannelConfig, ChannelType } from "@/lib/types";

const counters = { ch: 0, clip: 0, bus: 0, auto: 0 };
type IdKind = keyof typeof counters;

function next(kind: IdKind): string {
  counters[kind] += 1;
  return `${kind}-${counters[kind]}`;
}

export const newClipId = () => next("clip");
export const newBusId = () => next("bus");
export const newAutomationLaneId = () => next("auto");

/** After restoring ids (opening a project), makes sure the next new id of
 * that kind can't collide with a restored one. */
export function bumpIdFrom(id: string): void {
  const match = id.match(/^(ch|clip|bus|auto)-(\d+)$/);
  if (!match) return;
  const kind = match[1] as IdKind;
  counters[kind] = Math.max(counters[kind], parseInt(match[2], 10));
}

/** A new, empty track; its color cycles with each new track. */
export function createChannel(name: string, type: ChannelType): ChannelConfig {
  const id = next("ch");
  return {
    id,
    name,
    volume: 0,
    pan: 0,
    colorIndex: counters.ch - 1,
    type,
    instrument: null,
    muted: false,
    solo: false,
    armed: false,
  };
}
