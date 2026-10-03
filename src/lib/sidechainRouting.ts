// Sidechain routing: which track keys which effect, and how to keep the key
// in time with the audio it controls. Shared by the live engine and the WAV
// export so both route alike.
//
// Loops: a key can't come from a track that (through sends or other
// sidechains) is fed by the effect's own track - that would be a feedback
// loop, which Web Audio silences. Links are accepted in order and a link
// that would close a loop is left out (the effect then listens to its own
// input).
//
// Timing: the key is tapped on the source track (before its effects, after
// them, or after its fader), and each point reaches the tap some time after
// the timeline says, because of latent effects and delay compensation (see
// latency.ts). The effect's input is late too, by whatever comes before it.
// The key is delayed by the difference so a kick and the bass it ducks
// line up; a key that's already later than the effect's input can't be
// pulled earlier, so it stays as is (a few ms at most, in practice).

import type { SidechainRouting, SidechainTap } from "./sidechainModel";

export interface RoutingSnapshot {
  channels: {
    id: string;
    /** Bus ids this channel sends to. */
    sends: string[];
    /** Latency (s) of its active effects. */
    chain: number;
    /** Its compensation delay (s). */
    pdc: number;
    /** Delay (s) from its strip to the master (the shared direct delay, or
     * 0 for a live track). */
    toMaster: number;
    /** The track it feeds, if not the master (routing.ts). */
    dest?: string | null;
    /** How late (s) audio reaches the start of its effects (its own
     * sources wait for the tracks routed into it). */
    start?: number;
    /** Delay (s) on its sends. */
    send?: number;
  }[];
  buses: { id: string; chain: number; pdc: number }[];
}

export interface SidechainRequest {
  hostId: string;
  effectId: string;
  routing: SidechainRouting | undefined;
}

/** For each host id: the ids it takes audio from (a bus from the channels
 * sending to it; the master from everything). */
function feeds(snapshot: RoutingSnapshot): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  const add = (to: string, from: string) => {
    if (!graph.has(to)) graph.set(to, new Set());
    graph.get(to)!.add(from);
  };
  snapshot.channels.forEach((c) => {
    c.sends.forEach((bus) => add(bus, c.id));
    add(c.dest ?? "master", c.id);
  });
  snapshot.buses.forEach((b) => add("master", b.id));
  return graph;
}

/** Whether `from`'s audio (transitively) reaches `to`. */
function reaches(graph: Map<string, Set<string>>, from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length) {
    const node = stack.pop()!;
    if (node === from) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    graph.get(node)?.forEach((n) => stack.push(n));
  }
  return false;
}

function sourceExists(snapshot: RoutingSnapshot, id: string): boolean {
  return snapshot.channels.some((c) => c.id === id) || snapshot.buses.some((b) => b.id === id);
}

/** The requests that can be connected, in order, without a loop: effect id
 * -> source id. Off, sourceless or dangling requests are left out too. */
export function resolveSidechains(snapshot: RoutingSnapshot, requests: SidechainRequest[]): Map<string, string> {
  const graph = feeds(snapshot);
  const accepted = new Map<string, string>();
  requests.forEach(({ hostId, effectId, routing }) => {
    const source = routing?.on ? routing.source : null;
    if (!source || source === hostId || !sourceExists(snapshot, source)) return;
    // The link makes the host depend on the source: fine unless the host
    // already reaches the source.
    if (reaches(graph, hostId, source)) return;
    if (!graph.has(hostId)) graph.set(hostId, new Set());
    graph.get(hostId)!.add(source);
    accepted.set(effectId, source);
  });
  return accepted;
}

/** Whether an effect on `hostId` could take its key from `source`, given
 * the other effects' links - for greying out choices that would loop. */
export function canKeyFrom(snapshot: RoutingSnapshot, others: SidechainRequest[], hostId: string, source: string): boolean {
  if (source === hostId || source === "master" || !sourceExists(snapshot, source)) return false;
  const probe = "__probe__";
  const accepted = resolveSidechains(snapshot, [...others, { hostId, effectId: probe, routing: { on: true, source, tap: "postFx" } }]);
  return accepted.has(probe);
}

/** How late (s) audio reaches a bus's input: its latest sender's strip. */
function busInput(snapshot: RoutingSnapshot, busId: string): number {
  let latest = 0;
  snapshot.channels.forEach((c) => {
    if (c.sends.includes(busId)) latest = Math.max(latest, (c.start ?? 0) + c.chain + c.pdc + (c.send ?? 0));
  });
  return latest;
}

/** How late (s) audio reaches the start of a host's effects chain. */
export function hostInputLatency(snapshot: RoutingSnapshot, hostId: string): number {
  if (hostId === "master") {
    let latest = 0;
    snapshot.channels.forEach((c) => {
      if (!c.dest) latest = Math.max(latest, (c.start ?? 0) + c.chain + c.pdc + c.toMaster);
    });
    snapshot.buses.forEach((b) => (latest = Math.max(latest, busInput(snapshot, b.id) + b.chain + b.pdc)));
    return latest;
  }
  if (snapshot.buses.some((b) => b.id === hostId)) return busInput(snapshot, hostId);
  return snapshot.channels.find((c) => c.id === hostId)?.start ?? 0;
}

/** How late (s) a source's audio is at a tap point. */
export function tapLatency(snapshot: RoutingSnapshot, sourceId: string, tap: SidechainTap): number {
  const channel = snapshot.channels.find((c) => c.id === sourceId);
  const bus = snapshot.buses.find((b) => b.id === sourceId);
  const start = bus ? busInput(snapshot, sourceId) : (channel?.start ?? 0);
  const node = channel ?? bus;
  if (!node || tap === "preFx") return start;
  return start + node.chain + (tap === "postFader" ? node.pdc : 0);
}

/** The delay (s) to put on a key so it lines up with the effect's input:
 * `before` is the latency of the active effects ahead of the keyed one. */
export function keyDelay(snapshot: RoutingSnapshot, hostId: string, before: number, sourceId: string, tap: SidechainTap): number {
  return Math.max(0, hostInputLatency(snapshot, hostId) + before - tapLatency(snapshot, sourceId, tap));
}
