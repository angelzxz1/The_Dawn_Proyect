// Why a track can't be heard, when it's for a reason other than its own
// Mute (which its M button shows): another track is soloed, what it plays
// into is muted, its fader is all the way down, or it's a MIDI track with
// no instrument. Each track header says so, so silence is never a
// mystery. Pure.

import { downstreamOf, routeMap, soloAudible, type RouteNode } from "../engine/routing";
import type { ChannelConfig } from "./types";

export type SilentReason =
  /** Another track is soloed, and this one isn't on its path. */
  | { kind: "solo" }
  /** It plays into a track (a group, or one it's sent Audio To) that's
   * muted. */
  | { kind: "routeMuted"; via: string }
  /** Its fader is at the bottom (-60 dB reads -inf: off). */
  | { kind: "faderDown" }
  /** A MIDI track with nothing to play its notes. */
  | { kind: "noInstrument" };

/** A fader this low is off (the header reads it -inf). */
export const FADER_OFF_DB = -60;

export type SilentTrack = RouteNode & Pick<ChannelConfig, "name" | "muted" | "solo" | "instrument" | "volume">;

/** Each silent track's reason (tracks muted themselves aren't in it). */
export function silentReasons(tracks: readonly SilentTrack[], routes = routeMap([...tracks])): Map<string, SilentReason> {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const open = soloAudible([...tracks], routes);
  const out = new Map<string, SilentReason>();
  for (const t of tracks) {
    if (t.muted) continue;
    if (t.type === "midi" && !t.instrument) {
      out.set(t.id, { kind: "noInstrument" });
      continue;
    }
    const mutedOn = downstreamOf(t.id, routes)
      .map((id) => byId.get(id))
      .find((d) => d?.muted);
    if (mutedOn) out.set(t.id, { kind: "routeMuted", via: mutedOn.name });
    else if (!open.has(t.id)) out.set(t.id, { kind: "solo" });
    else if (t.volume <= FADER_OFF_DB) out.set(t.id, { kind: "faderDown" });
  }
  return out;
}

/** What a track header says about it: a short label and the whole story. */
export function silentText(reason: SilentReason): { label: string; detail: string } {
  switch (reason.kind) {
    case "solo":
      return { label: "Silent", detail: "Silent: another track is soloed. Solo this one too, or unsolo the others, to hear it." };
    case "routeMuted":
      return { label: "Silent", detail: `Silent: it plays through ${reason.via}, which is muted.` };
    case "faderDown":
      return { label: "Silent", detail: "Silent: its fader is all the way down." };
    case "noInstrument":
      return { label: "No instrument", detail: "Silent: no instrument plays its notes. Pick one in the FX rack." };
  }
}
