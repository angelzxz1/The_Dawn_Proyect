// Where each track's audio goes, and track groups (like Ableton's group
// tracks or Reaper's folders).
//
// Every track ends at the master, but on the way it can pass through
// another track: a group track (whose members feed it by default) or an
// audio track chosen as its output ("Audio to"), whose effects then process
// it. A route that would loop back on itself is ignored (the track goes to
// the master), so the graph is always a tree.
//
// Groups are one level deep: a group can't be inside another group. A
// group's members sit right after it in the track list.

import type { ChannelConfig } from "./types";

/** The parts of a track that decide its routing. */
export type RouteNode = Pick<ChannelConfig, "id" | "type" | "groupId" | "output">;

/** `output` value for "straight to the master, even inside a group". */
export const MASTER_OUTPUT = "master";

/** Which tracks can take other tracks' audio: groups and audio tracks. */
export function canReceive(node: Pick<ChannelConfig, "type">): boolean {
  return node.type === "group" || node.type === "audio";
}

/** Each track's destination: another track's id, or null for the master. */
export function routeMap(nodes: RouteNode[]): Map<string, string | null> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const wanted = new Map<string, string | null>();
  nodes.forEach((n) => {
    let dest: string | null = null;
    if (n.output === MASTER_OUTPUT) dest = null;
    else if (n.output && n.output !== n.id && byId.has(n.output) && canReceive(byId.get(n.output)!)) dest = n.output;
    else if (n.groupId && n.groupId !== n.id && byId.get(n.groupId)?.type === "group") dest = n.groupId;
    wanted.set(n.id, dest);
  });
  // Break loops: in track order, a route that leads back to its own track
  // goes to the master instead.
  nodes.forEach((n) => {
    const seen = new Set([n.id]);
    let at = wanted.get(n.id) ?? null;
    while (at) {
      if (seen.has(at)) {
        wanted.set(n.id, null);
        break;
      }
      seen.add(at);
      at = wanted.get(at) ?? null;
    }
  });
  return wanted;
}

/** Every track whose audio (directly or not) flows into `id`. */
export function upstreamOf(id: string, routes: Map<string, string | null>): Set<string> {
  const result = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    routes.forEach((dest, from) => {
      if (dest && (dest === id || result.has(dest)) && !result.has(from)) {
        result.add(from);
        grew = true;
      }
    });
  }
  return result;
}

/** The tracks `id`'s audio passes through on the way to the master. */
export function downstreamOf(id: string, routes: Map<string, string | null>): string[] {
  const chain: string[] = [];
  let at = routes.get(id) ?? null;
  while (at && !chain.includes(at)) {
    chain.push(at);
    at = routes.get(at) ?? null;
  }
  return chain;
}

/** Tracks `id` could send its audio to: groups and audio tracks that don't
 * already feed into it. */
export function outputTargets<T extends RouteNode>(id: string, nodes: T[]): T[] {
  const routes = routeMap(nodes);
  const upstream = upstreamOf(id, routes);
  return nodes.filter((n) => n.id !== id && canReceive(n) && !upstream.has(n.id));
}

/** The tracks not silenced by solo: with nothing soloed, all of them;
 * otherwise each soloed track plus everything feeding it and everything it
 * passes through (soloing a group plays its members; soloing a member
 * keeps its group open). Mute is separate. */
export function soloAudible(nodes: (RouteNode & { solo?: boolean })[], routes = routeMap(nodes)): Set<string> {
  const soloed = nodes.filter((n) => n.solo);
  if (soloed.length === 0) return new Set(nodes.map((n) => n.id));
  const keep = new Set<string>();
  soloed.forEach((n) => {
    keep.add(n.id);
    upstreamOf(n.id, routes).forEach((id) => keep.add(id));
    downstreamOf(n.id, routes).forEach((id) => keep.add(id));
  });
  return keep;
}

// --- groups ---

/** Puts each group's members right after it (keeping their order), drops
 * group membership that points nowhere, and keeps groups one level deep. */
export function normalizeGroups<T extends ChannelConfig>(channels: T[]): T[] {
  const groups = new Set(channels.filter((c) => c.type === "group").map((c) => c.id));
  const clean = channels.map((c) => {
    if (!c.groupId) return c;
    if (c.type === "group" || !groups.has(c.groupId)) {
      const { groupId: _g, ...rest } = c;
      void _g;
      return rest as T;
    }
    return c;
  });
  const out: T[] = [];
  clean.forEach((c) => {
    if (c.groupId) return;
    out.push(c);
    if (c.type === "group") clean.filter((m) => m.groupId === c.id).forEach((m) => out.push(m));
  });
  return out;
}

/** Makes `group` (a new group track) the group of `ids`, placed where the
 * first of them was. */
export function groupTracks<T extends ChannelConfig>(channels: T[], ids: string[], group: T): T[] {
  const members = new Set(ids.filter((id) => channels.some((c) => c.id === id && c.type !== "group")));
  const at = channels.findIndex((c) => members.has(c.id));
  const next = channels.map((c) => (members.has(c.id) ? { ...c, groupId: group.id } : c));
  next.splice(at < 0 ? next.length : at, 0, { ...group, groupId: undefined });
  return normalizeGroups(next);
}

/** Dissolves a group: its members stay where they are, and go to wherever
 * the group went. Returns the tracks without the group. */
export function ungroup<T extends ChannelConfig>(channels: T[], groupId: string): T[] {
  const group = channels.find((c) => c.id === groupId);
  return channels
    .filter((c) => c.id !== groupId)
    .map((c) => {
      if (c.groupId !== groupId && c.output !== groupId) return c;
      const { groupId: _g, output, ...rest } = c;
      void _g;
      const keepOutput = output && output !== groupId ? output : group?.output && group.output !== MASTER_OUTPUT ? group.output : undefined;
      return (keepOutput ? { ...rest, output: keepOutput } : rest) as T;
    });
}

/** Moves a track into a group (at the end of it), or out of any group
 * (`groupId` null, placed right after the group). */
export function setTrackGroup<T extends ChannelConfig>(channels: T[], id: string, groupId: string | null): T[] {
  const track = channels.find((c) => c.id === id);
  if (!track || track.type === "group") return channels;
  const rest = channels.filter((c) => c.id !== id);
  let moved: T;
  if (groupId) {
    moved = { ...track, groupId };
  } else {
    const { groupId: _g, ...plain } = track;
    void _g;
    moved = plain as T;
  }
  const anchor = groupId ?? track.groupId;
  // At the end of the group's block (or after the block it's leaving).
  let index = rest.length;
  if (anchor) {
    const groupIndex = rest.findIndex((c) => c.id === anchor);
    if (groupIndex >= 0) {
      index = groupIndex + 1;
      while (index < rest.length && rest[index].groupId === anchor) index++;
    }
  }
  rest.splice(index, 0, moved);
  return normalizeGroups(rest);
}

/** Moves a track up (-1) or down (1): a group moves with its members, a
 * member moves within its group, and anything else steps past a whole
 * group at once. */
export function moveTrack<T extends ChannelConfig>(channels: T[], id: string, direction: -1 | 1): T[] {
  const track = channels.find((c) => c.id === id);
  if (!track) return channels;
  // Blocks: a group with its members, or a single track; members are
  // their own blocks within their group.
  const blocksOf = (list: T[]) => {
    const blocks: T[][] = [];
    list.forEach((c) => {
      if (c.groupId) return;
      blocks.push(c.type === "group" ? [c, ...list.filter((m) => m.groupId === c.id)] : [c]);
    });
    return blocks;
  };
  if (track.groupId) {
    const siblings = channels.filter((c) => c.groupId === track.groupId);
    const i = siblings.findIndex((c) => c.id === id);
    const j = i + direction;
    if (j < 0 || j >= siblings.length) return channels;
    const swapped = [...siblings];
    [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
    let k = 0;
    return channels.map((c) => (c.groupId === track.groupId ? swapped[k++] : c));
  }
  const blocks = blocksOf(channels);
  const i = blocks.findIndex((b) => b[0].id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= blocks.length) return channels;
  [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  return blocks.flat();
}

/** Whether a track can move up/down (for greying out its buttons). */
export function canMoveTrack(channels: ChannelConfig[], id: string, direction: -1 | 1): boolean {
  const moved = moveTrack(channels, id, direction);
  return moved !== channels && moved.some((c, i) => c.id !== channels[i].id);
}

/** Members hidden because their group is folded. */
export function hiddenByFoldedGroups(channels: ChannelConfig[]): Set<string> {
  const folded = new Set(channels.filter((c) => c.type === "group" && c.folded).map((c) => c.id));
  return new Set(channels.filter((c) => c.groupId && folded.has(c.groupId)).map((c) => c.id));
}
