// Delay compensation: some effects delay their audio (a limiter's
// lookahead, oversampling, a pitch shifter's window), which would put that track behind the others. Like a DAW's
// plugin delay compensation, every other path is delayed to match, so all
// of them reach the master together:
//
//   track sources -> effects (L) -> [delay: maxL - L] -> strip -> direct [D] -> master
//                                                             \-> sends -> bus effects (B) -> [delay: D - B] -> master
//
// with maxL the most latent track chain and D the most latent bus chain.
// Tracks being played live (monitored input, the armed MIDI track) can skip
// both delays so what you play isn't held back - "reduced latency when
// monitoring" - at the cost of being early against the rest by that much.
// The whole mix then comes out `total` late (plus the master chain's own
// latency), which the metronome, recording and export account for.
//
// A track can also feed another track (a group, or an audio track chosen as
// its output; see routing.ts). Then the tracks feeding a track are lined up
// at its input instead: each one's delay makes it arrive with the latest of
// them, the receiving track's own sources wait the same time (`own`), and
// its chain carries on from there. Sends leave a track's strip earlier than
// the mix reaches the master when it feeds another track, so they wait the
// difference (`send`) to stay in time with the dry path.
//
// A live track makes its whole path live: the group or audio track it plays
// through skips compensation too, or the live audio would wait in there.

import type * as Tone from "tone";

/** Seconds an effect node delays its audio (0 for most). */
export function nodeLatency(node: Tone.ToneAudioNode): number {
  const latency = "latency" in node ? node.latency : undefined;
  return typeof latency === "number" && Number.isFinite(latency) ? Math.max(0, latency) : 0;
}

/** Total latency of a chain's active (non-bypassed) effects. */
export function chainLatency(effects: { node: Tone.ToneAudioNode; bypass?: boolean }[]): number {
  return effects.reduce((sum, e) => sum + (e.bypass ? 0 : nodeLatency(e.node)), 0);
}

export interface CompensationInput {
  enabled: boolean;
  /** `live`: skip compensation (reduced latency while monitoring).
   * `dest`: the track this one feeds (unset or null: the master). */
  channels: { id: string; latency: number; live: boolean; dest?: string | null }[];
  buses: { id: string; latency: number }[];
  /** The master chain's own latency (its effects and limiter). */
  master: number;
}

export interface CompensationPlan {
  /** Delay (s) between each track's effects and its strip. */
  channel: Map<string, number>;
  /** Delay (s) on each track's own sources (instrument, clips, input), so
   * they wait for the tracks feeding it: when its effects start, in time. */
  own: Map<string, number>;
  /** Delay (s) on each track's sends, so they reach the buses in time with
   * its dry path through the tracks it feeds. */
  send: Map<string, number>;
  /** Delay (s) between each bus's effects and its strip. */
  bus: Map<string, number>;
  /** Delay (s) on the tracks' direct path to the master. */
  direct: number;
  /** How late the mix leaves the master (s): compensated track latency, bus
   * alignment and the master chain. */
  total: number;
  /** The largest latency being compensated for (s), for display. */
  compensated: number;
  /** Tracks treated as live: the live ones and every track they play
   * through on the way to the master. They go straight to the master. */
  live: Set<string>;
}

/** The live tracks plus every track their audio passes through. */
function livePath(channels: CompensationInput["channels"]): Set<string> {
  const byId = new Map(channels.map((c) => [c.id, c]));
  const live = new Set<string>();
  channels.forEach((c) => {
    if (!c.live) return;
    let at: string | null | undefined = c.id;
    while (at && byId.has(at) && !live.has(at)) {
      live.add(at);
      at = byId.get(at)!.dest;
    }
  });
  return live;
}

export function planCompensation(input: CompensationInput): CompensationPlan {
  const channel = new Map<string, number>();
  const own = new Map<string, number>();
  const send = new Map<string, number>();
  const bus = new Map<string, number>();
  const live = livePath(input.channels);
  if (!input.enabled) {
    input.channels.forEach((c) => {
      channel.set(c.id, 0);
      own.set(c.id, 0);
      send.set(c.id, 0);
    });
    input.buses.forEach((b) => bus.set(b.id, 0));
    return { channel, own, send, bus, direct: 0, total: input.master, compensated: 0, live };
  }
  const byId = new Map(input.channels.map((c) => [c.id, { ...c, live: live.has(c.id) }]));
  const channels = [...byId.values()];
  const destOf = (c: { dest?: string | null }) => (c.dest && byId.has(c.dest) ? c.dest : null);
  // When the audio feeding a track's effects is all in (its latest
  // non-live feeder), and when it leaves them. Routes form a tree
  // (routing.ts breaks loops); `seen` guards against a bad input anyway.
  const inMemo = new Map<string, number>();
  const timeIn = (id: string, seen: Set<string> = new Set()): number => {
    if (inMemo.has(id)) return inMemo.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    let latest = 0;
    channels.forEach((k) => {
      if (!k.live && destOf(k) === id) latest = Math.max(latest, timeIn(k.id, seen) + k.latency);
    });
    inMemo.set(id, latest);
    return latest;
  };
  const timeOut = (id: string) => timeIn(id) + byId.get(id)!.latency;
  const maxTrack = Math.max(0, ...channels.filter((c) => !c.live && !destOf(c)).map((c) => timeOut(c.id)));
  const direct = Math.max(0, ...input.buses.map((b) => b.latency));
  channels.forEach((c) => {
    const dest = destOf(c);
    if (c.live) {
      channel.set(c.id, 0);
      own.set(c.id, 0);
      send.set(c.id, 0);
      return;
    }
    const leaves = dest ? timeIn(dest) : maxTrack;
    channel.set(c.id, Math.max(0, leaves - timeOut(c.id)));
    own.set(c.id, timeIn(c.id));
    send.set(c.id, Math.max(0, maxTrack - leaves));
  });
  input.buses.forEach((b) => bus.set(b.id, direct - b.latency));
  return { channel, own, send, bus, direct, total: maxTrack + direct + input.master, compensated: maxTrack + direct, live };
}

/** Where a burst of clicks came back in a recording: each click (the
 * `click` waveform) was sent at `sentFrames[i]` (frames, on the recording's
 * own clock); it's found by cross-correlating the recording against the
 * click. Resolves with the delay in seconds - the median over the clicks -
 * or null when they weren't clearly heard or the delays disagree. */
export function detectRoundTrip(samples: Float32Array, sampleRate: number, sentFrames: number[], click: Float32Array): number | null {
  const maxDelay = Math.round(0.5 * sampleRate);
  const n = click.length;
  let clickEnergy = 0;
  for (const v of click) clickEnergy += v * v;
  const delays: number[] = [];
  for (const sent of sentFrames) {
    let best = 0;
    let bestLag = -1;
    // Running energy of the recording under the click, for normalizing.
    let energy = 0;
    for (let i = 0; i < n; i++) energy += (samples[sent + i] ?? 0) ** 2;
    for (let lag = 0; lag <= maxDelay && sent + lag + n <= samples.length; lag++) {
      if (lag > 0) energy += samples[sent + lag + n - 1] ** 2 - samples[sent + lag - 1] ** 2;
      let c = 0;
      for (let i = 0; i < n; i++) c += click[i] * samples[sent + lag + i];
      // Polarity can flip on the way (speaker, mic, interface), so |c|.
      const score = Math.abs(c) / Math.sqrt(clickEnergy * Math.max(energy, 1e-12));
      if (score > best) {
        best = score;
        bestLag = lag;
      }
    }
    if (bestLag < 0 || best < 0.5) return null;
    delays.push(bestLag / sampleRate);
  }
  delays.sort((x, y) => x - y);
  const median = delays[Math.floor(delays.length / 2)];
  // They should agree to within a millisecond.
  if (delays.some((d) => Math.abs(d - median) > 0.001)) return null;
  return median;
}
