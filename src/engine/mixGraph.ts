// The mix as a plan: where every track's audio goes, how much each path is
// delayed, what's heard, and which effects are keyed by which track. One
// pure function decides all of it from the project's routing and the
// effects' latencies, and both the live engine (audioEngine.ts) and the
// export (bounce.ts) apply the same plan to their own nodes - so what you
// export is what you hear.
//
// The pieces it brings together: routing.ts (groups, Audio To / From, solo
// paths), latency.ts (delay compensation) and sidechainRouting.ts (keys
// without loops, lined up in time).

import { planCompensation, type CompensationPlan } from "./latency";
import { inputMap, MASTER_OUTPUT, routeMap, soloAudible, type RouteNode } from "./routing";
import { keyDelay, resolveSidechains, type RoutingSnapshot, type SidechainRequest } from "../effects/sidechain/sidechainRouting";
import type { SidechainRouting, SidechainTap } from "../effects/sidechain/sidechainModel";
import type { TrackInput } from "../project/types";

export interface MixTrack extends RouteNode {
  /** Latency (s) of its active effects. */
  latency: number;
  /** Played live (monitored, or the armed MIDI track): skips compensation
   * so what you play isn't held back. */
  live: boolean;
  muted: boolean;
  solo: boolean;
  /** Bus ids it sends to. */
  sends: string[];
}

export interface MixBus {
  id: string;
  latency: number;
}

/** A track, bus or "master" with its effects in order, for sidechains. */
export interface MixHost {
  id: string;
  effects: {
    id: string;
    /** Latency (s) it adds when active. */
    latency: number;
    bypass: boolean;
    /** Whether it can take a key (a compressor, gate...). */
    keyed: boolean;
    sidechain?: SidechainRouting;
  }[];
}

export interface MixInput {
  /** In track order (it decides which route wins when two would loop). */
  tracks: MixTrack[];
  buses: MixBus[];
  /** Latency (s) of the master chain: its effects and limiter. */
  masterLatency: number;
  /** Plugin delay compensation on. */
  compensation: boolean;
  hosts: MixHost[];
}

/** Where a track's strip connects: into another track, straight to the
 * master (live tracks), or through the shared direct delay to it. */
export type MixOutput = { kind: "track"; id: string } | { kind: "master" } | { kind: "direct" };

export interface MixGraph {
  /** Each track's destination track, or null for the master. */
  routes: Map<string, string | null>;
  outputs: Map<string, MixOutput>;
  /** Audio tracks taking another track's audio as their input. */
  inputs: Map<string, TrackInput>;
  /** Delay compensation (latency.ts). */
  plan: CompensationPlan;
  /** Tracks heard: not muted, and on a soloed path if anything is soloed. */
  audible: Set<string>;
  /** Routing and latencies, for timing keys and recordings. */
  snapshot: RoutingSnapshot;
  /** The sidechain requests (keyed effects with a source chosen). */
  requests: SidechainRequest[];
  /** Keyed effects that are connected: effect id -> where its key comes
   * from and how long to delay it to line up with the effect's input. */
  sidechains: Map<string, { source: string; tap: SidechainTap; delay: number }>;
}

/** The tracks heard in the mix: unmuted, and (if anything is soloed) on a
 * soloed track's path - its group, the tracks feeding it. */
export function audibleTracks(tracks: (RouteNode & { muted: boolean; solo: boolean })[], routes = routeMap(tracks)): Set<string> {
  const open = soloAudible(tracks, routes);
  return new Set(tracks.filter((t) => !t.muted && open.has(t.id)).map((t) => t.id));
}

export function planMix(input: MixInput): MixGraph {
  const routes = routeMap(input.tracks);
  const inputs = inputMap(input.tracks, routes);
  const destOf = (id: string) => routes.get(id) ?? null;

  const plan = planCompensation({
    enabled: input.compensation,
    channels: input.tracks.map((t) => ({ id: t.id, latency: t.latency, live: t.live, dest: destOf(t.id) })),
    buses: input.buses,
    master: input.masterLatency,
  });

  const outputs = new Map<string, MixOutput>();
  input.tracks.forEach((t) => {
    const dest = destOf(t.id);
    outputs.set(t.id, dest ? { kind: "track", id: dest } : plan.live.has(t.id) ? { kind: "master" } : { kind: "direct" });
  });

  const snapshot: RoutingSnapshot = {
    channels: input.tracks.map((t) => ({
      id: t.id,
      sends: t.sends,
      chain: t.latency,
      pdc: plan.channel.get(t.id) ?? 0,
      toMaster: outputs.get(t.id)!.kind === "master" ? 0 : plan.direct,
      dest: destOf(t.id),
      start: plan.own.get(t.id) ?? 0,
      send: plan.send.get(t.id) ?? 0,
      inputFrom: inputs.get(t.id)?.track ?? null,
    })),
    buses: input.buses.map((b) => ({ id: b.id, chain: b.latency, pdc: plan.bus.get(b.id) ?? 0 })),
  };

  const requests: SidechainRequest[] = input.hosts.flatMap((h) =>
    h.effects.filter((e) => e.keyed && e.sidechain).map((e) => ({ hostId: h.id, effectId: e.id, routing: e.sidechain }))
  );
  const accepted = resolveSidechains(snapshot, requests);
  const sidechains = new Map<string, { source: string; tap: SidechainTap; delay: number }>();
  input.hosts.forEach((h) => {
    // The key lines up with the effect's input: after the effects before it.
    let before = 0;
    h.effects.forEach((e) => {
      const source = accepted.get(e.id);
      if (source && e.keyed) {
        const tap = e.sidechain?.tap ?? "postFx";
        sidechains.set(e.id, { source, tap, delay: keyDelay(snapshot, h.id, before, source, tap) });
      }
      if (!e.bypass) before += e.latency;
    });
  });

  return { routes, outputs, inputs, plan, audible: audibleTracks(input.tracks, routes), snapshot, requests, sidechains };
}

export { MASTER_OUTPUT };
