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

import type * as Tone from "tone";

/** Seconds an effect node delays its audio (0 for most). */
export function nodeLatency(node: Tone.ToneAudioNode): number {
  const latency = (node as unknown as { latency?: unknown }).latency;
  return typeof latency === "number" && Number.isFinite(latency) ? Math.max(0, latency) : 0;
}

/** Total latency of a chain's active (non-bypassed) effects. */
export function chainLatency(effects: { node: Tone.ToneAudioNode; bypass?: boolean }[]): number {
  return effects.reduce((sum, e) => sum + (e.bypass ? 0 : nodeLatency(e.node)), 0);
}

export interface CompensationInput {
  enabled: boolean;
  /** `live`: skip compensation (reduced latency while monitoring). */
  channels: { id: string; latency: number; live: boolean }[];
  buses: { id: string; latency: number }[];
  /** The master chain's own latency (its effects and limiter). */
  master: number;
}

export interface CompensationPlan {
  /** Delay (s) between each track's effects and its strip. */
  channel: Map<string, number>;
  /** Delay (s) between each bus's effects and its strip. */
  bus: Map<string, number>;
  /** Delay (s) on the tracks' direct path to the master. */
  direct: number;
  /** How late the mix leaves the master (s): compensated track latency, bus
   * alignment and the master chain. */
  total: number;
  /** The largest latency being compensated for (s), for display. */
  compensated: number;
}

export function planCompensation(input: CompensationInput): CompensationPlan {
  const channel = new Map<string, number>();
  const bus = new Map<string, number>();
  if (!input.enabled) {
    input.channels.forEach((c) => channel.set(c.id, 0));
    input.buses.forEach((b) => bus.set(b.id, 0));
    return { channel, bus, direct: 0, total: input.master, compensated: 0 };
  }
  const maxTrack = Math.max(0, ...input.channels.filter((c) => !c.live).map((c) => c.latency));
  const direct = Math.max(0, ...input.buses.map((b) => b.latency));
  input.channels.forEach((c) => channel.set(c.id, c.live ? 0 : maxTrack - c.latency));
  input.buses.forEach((b) => bus.set(b.id, direct - b.latency));
  return { channel, bus, direct, total: maxTrack + direct + input.master, compensated: maxTrack + direct };
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
