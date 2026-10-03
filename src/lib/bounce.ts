// Renders the project offline using Tone.Offline - a second, throwaway
// audio graph built the same way the live engine builds its channels,
// rendered faster than real time, with no audible side effects on the real
// engine or speakers. The whole mix, a range of it, or one track at a time
// (stems), which exportProject.ts turns into WAV or MP3 files.

import * as Tone from "tone";
import { createInstrument, createEffectNode, applyEffectParam, IrLoaderChain } from "./audioEngine";
import { decodeEffectFileAudio, readEffectFileText, referencedEffectFiles } from "./effectFiles";
import { NamAmpChain } from "./namAmp";
import { SynthInstrument } from "./synth";
import { DrumRack } from "./drumRack";
import { notesWithinClip } from "./project";
import { workletsReady } from "./workletLoader";
import { chainLatency, nodeLatency, planCompensation } from "./latency";
import { keyDelay, resolveSidechains, type RoutingSnapshot, type SidechainRequest } from "./sidechainRouting";
import type { SidechainTap } from "./sidechainModel";
import { encodeWav } from "./wav";
import type { BusConfig, ChannelConfig, ClipInstance, MidiClipInstance } from "./types";
import type { EffectInstance } from "./effects";
import { downstreamOf, routeMap, soloAudible, upstreamOf } from "./routing";

const MIN_NOTE_DURATION = 0.05;
/** Default extra render time so reverb/delay tails aren't cut off. */
export const TAIL_SECONDS = 2;

export interface BounceParams {
  channels: ChannelConfig[];
  clipsByChannel: Record<string, ClipInstance[]>;
  channelEffects: Record<string, EffectInstance[]>;
  buses: BusConfig[];
  busEffects: Record<string, EffectInstance[]>;
  masterVolume: number;
  masterPan: number;
  masterLimiterThreshold: number;
  masterEffects: EffectInstance[];
  /** Where the last bit of content ends, in seconds - the render runs a
   * couple of seconds past this for effect tails. */
  contentEndSeconds: number;
  /** Plugin delay compensation, as in playback (default on). */
  delayCompensation?: boolean;
}

/** Longest delay compensation can add to one path (s). */
const MAX_COMPENSATION = 2;

export interface RenderOptions {
  /** Render only this track (with its sends into buses), for a stem -
   * with the tracks routed into it (a group's members). Tracks keying its
   * sidechains are still rendered, silently. */
  only?: string;
  /** Run the master bus's effects and limiter (default true). Stems leave
   * them out so they add up to the mix as it enters the master effects. */
  masterChain?: boolean;
  /** The part of the song to render (s); defaults to all of it. Nothing
   * starts after `end`, and notes or clips still playing are cut there;
   * the tail after it is only effects ringing out. */
  start?: number;
  end?: number;
  /** Seconds kept after the end for reverb and delay tails. */
  tailSeconds?: number;
}

export interface RenderedAudio {
  /** One array per channel (stereo). */
  channels: Float32Array[];
  sampleRate: number;
}

/** Linearly interpolates an automation lane's value at time `t` - flat
 * before the first point and after the last. Kept in sync with
 * audioEngine.ts's own copy (identical logic, but the offline render can't
 * share the live engine's private instance method). */
function interpolateAutomation(points: { time: number; value: number }[], t: number): number | null {
  if (points.length === 0) return null;
  if (points.length === 1 || t <= points[0].time) return points[0].value;
  const last = points[points.length - 1];
  if (t >= last.time) return last.value;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (t >= a.time && t <= b.time) {
      const ratio = (t - a.time) / (b.time - a.time || 1);
      return a.value + (b.value - a.value) * ratio;
    }
  }
  return last.value;
}

/** Builds one effects rack (skipping bypassed entries, matching the live
 * engine's audioEngine.ts `wireEffectsChain`) feeding into `dest`, and
 * returns its entry point plus a lookup from effect id to its live node (so
 * automation can later reach into it by the same id the UI uses). */
interface OfflineFiles {
  /** Decoded IRs, by effect-file id. */
  audio: Map<string, AudioBuffer | null>;
  /** NAM model contents, by effect-file id. */
  text: Map<string, string | null>;
  /** Amp model loads still in flight - the render waits for these. */
  loads: Promise<unknown>[];
}

function buildOfflineEffectsChain(
  effects: EffectInstance[],
  dest: Tone.ToneAudioNode,
  files: OfflineFiles
): {
  entry: Tone.ToneAudioNode;
  nodesById: Map<string, { node: Tone.ToneAudioNode; type: EffectInstance["type"] }>;
  latency: number;
  built: { fx: EffectInstance; node: Tone.ToneAudioNode }[];
} {
  const built = effects.map((fx) => ({ fx, node: createEffectNode(fx.type, fx.params) }));
  built.forEach(({ fx, node }) => {
    Object.entries(fx.params).forEach(([key, value]) => applyEffectParam(node, fx.type, key, value));
    if (fx.file && node instanceof IrLoaderChain) node.setImpulse(files.audio.get(fx.file.id) ?? null);
    if (fx.file && node instanceof NamAmpChain) {
      files.loads.push(node.setModel(fx.file.id, files.text.get(fx.file.id) ?? null));
    }
  });
  const active = built.filter(({ fx }) => !fx.bypass);
  for (let i = 0; i < active.length; i++) {
    const next = active[i + 1]?.node ?? dest;
    active[i].node.connect(next);
  }
  const nodesById = new Map(built.map(({ fx, node }) => [fx.id, { node, type: fx.type }]));
  return { entry: active[0]?.node ?? dest, nodesById, latency: chainLatency(active.map(({ node }) => ({ node }))), built };
}

function isMidiClip(c: ClipInstance): c is MidiClipInstance {
  return c.kind === "midi";
}

/** The tracks heard in the mix: unmuted, and (if anything is soloed) on a
 * soloed track's path - its group, the tracks feeding it (routing.ts). */
export function audibleChannels(channels: ChannelConfig[]): ChannelConfig[] {
  const open = soloAudible(channels);
  return channels.filter((c) => !c.muted && open.has(c.id));
}

/** Renders the project offline and resolves with a 16-bit WAV file Blob. */
export async function bounceProjectToWav(params: BounceParams): Promise<Blob> {
  const audio = await renderProject(params);
  return encodeWav(audio.channels, audio.sampleRate, 16);
}

/** Renders the project (or part of it, or one track of it) offline. */
export async function renderProject(params: BounceParams, options: RenderOptions = {}): Promise<RenderedAudio> {
  const rangeStart = Math.max(0, options.start ?? 0);
  const rangeEnd = options.end ?? params.contentEndSeconds;
  const cutAt = options.end; // only a chosen range cuts sources off
  const tail = Math.max(0, options.tailSeconds ?? TAIL_SECONDS);
  const masterChain = options.masterChain ?? true;
  // Room for the mix's own latency, which is trimmed off the front after.
  const renderEnd = Math.max(rangeStart + 1, rangeEnd + tail);
  const duration = renderEnd + MAX_COMPENSATION;
  let latency = 0;

  // Only the channels that would actually be heard in the real mix: if any
  // channel is soloed, everything else is silent; otherwise muted channels
  // are simply left out of the render. A stem is its one track.
  const routes = routeMap(params.channels);
  const heard = audibleChannels(params.channels);
  const stem = options.only ? new Set([options.only, ...upstreamOf(options.only, routes)]) : null;
  const audible = new Set(stem ? heard.filter((c) => stem.has(c.id) || c.id === options.only) : heard);
  // A track keying a sidechain is rendered even when it isn't heard (a
  // muted "ghost" kick ducking the bass), with its strip muted as it is in
  // playback.
  const keySources = new Set(
    [params.masterEffects, ...Object.values(params.busEffects), ...Object.values(params.channelEffects)]
      .flat()
      .map((fx) => (fx.sidechain?.on ? fx.sidechain.source : null))
  );
  // A heard track's audio needs the tracks it passes through (a muted
  // group is still built, its strip silent).
  const needed = new Set<string>();
  params.channels.forEach((c) => {
    if (!audible.has(c) && !keySources.has(c.id)) return;
    needed.add(c.id);
    downstreamOf(c.id, routes).forEach((id) => needed.add(id));
  });
  const rendered = params.channels.filter((c) => needed.has(c.id));

  // Uploaded effect files (IRs) are decoded up front, at the rate the
  // offline render runs at (Tone.Offline's default: the live context's).
  const sampleRate = Tone.getContext().sampleRate;
  const files: OfflineFiles = { audio: new Map(), text: new Map(), loads: [] };
  const allEffects = [params.masterEffects, ...Object.values(params.busEffects), ...Object.values(params.channelEffects)];
  const refsOfType = (type: EffectInstance["type"]) =>
    referencedEffectFiles(allEffects.map((list) => list.filter((fx) => fx.type === type)));
  await Promise.all([
    ...refsOfType("irLoader").map(async (ref) => files.audio.set(ref.id, await decodeEffectFileAudio(ref.id, sampleRate))),
    ...refsOfType("namAmp").map(async (ref) => files.text.set(ref.id, await readEffectFileText(ref.id))),
  ]);

  const buffer = await Tone.Offline(async () => {
    const masterMeter = new Tone.Meter();
    // Same LimiterChain the live engine's master uses, so the export
    // limits identically to playback.
    // Same release as the live master limiter (LookaheadLimiter's default).
    const masterLimiter = masterChain
      ? createEffectNode("limiter", {
          threshold: params.masterLimiterThreshold,
          gain: 0,
          release: 0.1,
          softClip: 0,
        }).connect(masterMeter)
      : null;
    masterMeter.toDestination();
    // channelCount: 2 on every Channel here - see audioEngine.ts's
    // addChannel for why: Tone.Channel's Panner defaults to explicit
    // mono, silently folding any stereo content (a stereo delay, etc.)
    // down before panning, at each stage it passes through.
    const master = new Tone.Channel({ volume: params.masterVolume, pan: params.masterPan, channelCount: 2 });
    const { entry: masterEntry, latency: masterLatency, built: masterBuilt } = masterLimiter
      ? buildOfflineEffectsChain(params.masterEffects, masterLimiter, files)
      : { entry: masterMeter, latency: 0, built: [] };
    master.connect(masterEntry);

    // Delay compensation, as the live engine does it (see latency.ts).
    const direct = new Tone.Delay(0, MAX_COMPENSATION).connect(master);
    const compensation: {
      channels: { id: string; latency: number; pdc: Tone.Delay; own: Tone.Delay; send: Tone.Delay; strip: Tone.Channel; routeIn: Tone.Gain }[];
      buses: { id: string; latency: number; pdc: Tone.Delay }[];
    } = {
      channels: [],
      buses: [],
    };

    // Sidechain tap points and keyed effects, per track/bus (see the live
    // engine's rewireSidechains).
    const taps = new Map<string, Record<SidechainTap, Tone.ToneAudioNode>>();
    const hosts: { id: string; built: { fx: EffectInstance; node: Tone.ToneAudioNode }[] }[] = [];
    const sendsOf = new Map<string, string[]>();

    const buses = new Map<string, { input: Tone.Gain }>();
    params.buses.forEach((bus) => {
      const input = new Tone.Gain(1);
      const channel = new Tone.Channel({ volume: 0, pan: 0, channelCount: 2 }).connect(master);
      const pdc = new Tone.Delay(0, MAX_COMPENSATION).connect(channel);
      const postFx = new Tone.Gain().connect(pdc);
      const { entry, latency: busLatency, built } = buildOfflineEffectsChain(params.busEffects[bus.id] ?? [], postFx, files);
      input.connect(entry);
      buses.set(bus.id, { input });
      compensation.buses.push({ id: bus.id, latency: busLatency, pdc });
      taps.set(bus.id, { preFx: input, postFx, postFader: channel });
      hosts.push({ id: bus.id, built });
    });

    const loadPromises: Promise<void>[] = [];
    // Automation: one entry per (channel, lane), each remembering exactly
    // the live node(s) it should drive, replayed at the same control rate
    // the live engine uses (see audioEngine.ts's `ensureAutomationLoop`) so
    // a bounce matches what playback actually sounds like.
    const automationEntries: {
      lane: NonNullable<ChannelConfig["automationLanes"]>[number];
      strip: Tone.Channel;
      effectNodesById: Map<string, { node: Tone.ToneAudioNode; type: EffectInstance["type"] }>;
    }[] = [];

    rendered.forEach((channel) => {
      // Its output is connected once every track exists (below).
      const strip = new Tone.Channel({ volume: channel.volume, pan: channel.pan, channelCount: 2, mute: !audible.has(channel) });
      const pdc = new Tone.Delay(0, MAX_COMPENSATION).connect(strip);
      const sendTap = new Tone.Delay(0, MAX_COMPENSATION);
      strip.connect(sendTap);
      const sends: string[] = [];
      Object.entries(channel.sends ?? {}).forEach(([busId, db]) => {
        const bus = buses.get(busId);
        if (!bus) return;
        const send = new Tone.Gain(Tone.dbToGain(db));
        sendTap.connect(send);
        send.connect(bus.input);
        sends.push(busId);
      });
      sendsOf.set(channel.id, sends);
      const postFx = new Tone.Gain().connect(pdc);
      const { entry, nodesById, latency: trackLatency, built } = buildOfflineEffectsChain(
        params.channelEffects[channel.id] ?? [],
        postFx,
        files
      );
      // Sources go into the pre-FX tap, which feeds the chain: its own
      // (delayed to wait for routed-in audio) and other tracks' audio.
      const firstNode = new Tone.Gain().connect(entry);
      const ownDelay = new Tone.Delay(0, MAX_COMPENSATION).connect(firstNode);
      const routeIn = new Tone.Gain().connect(firstNode);
      compensation.channels.push({ id: channel.id, latency: trackLatency, pdc, own: ownDelay, send: sendTap, strip, routeIn });
      taps.set(channel.id, { preFx: firstNode, postFx, postFader: strip });
      hosts.push({ id: channel.id, built });

      (channel.automationLanes ?? []).forEach((lane) => {
        automationEntries.push({ lane, strip, effectNodesById: nodesById });
      });

      const clips = params.clipsByChannel[channel.id] ?? [];

      if (channel.type === "midi") {
        const instrument = createInstrument(channel.instrument, () => {}, channel.synthParams, channel.drumParams);
        instrument.connect(ownDelay);
        const flattened = clips
          .filter(isMidiClip)
          .flatMap((clip) => notesWithinClip(clip).map((n) => ({ ...n, time: clip.offset + n.time })))
          .filter((n) => cutAt === undefined || n.time < cutAt)
          .map((n) => (cutAt === undefined ? n : { ...n, duration: Math.min(n.duration, cutAt - n.time) }));
        // Notes are scheduled once the instrument's samples (if any) have
        // loaded - Tone.Offline awaits every promise pushed here before it
        // starts rendering.
        loadPromises.push(
          (async () => {
            await new Promise<void>((resolve) => {
              if (instrument instanceof Tone.Sampler) {
                const check = () => (instrument.loaded ? resolve() : setTimeout(check, 10));
                check();
              } else if (instrument instanceof SynthInstrument || instrument instanceof DrumRack) {
                // Its worklet starts once its wavetables are ready (an imported one is decoded first).
                void instrument.ready.then(resolve, resolve);
              } else {
                resolve();
              }
            });
            flattened.forEach((n) => {
              try {
                instrument.triggerAttackRelease(
                  n.note,
                  Math.max(n.duration, MIN_NOTE_DURATION),
                  n.time,
                  n.velocity
                );
              } catch {
                // note outside a synth's usable range, etc. - skip it
              }
            });
          })()
        );
      } else {
        clips.forEach((clip) => {
          if (clip.kind !== "audio") return;
          if (cutAt !== undefined && clip.offset >= cutAt) return;
          const playLength = cutAt === undefined ? clip.length : Math.min(clip.length, cutAt - clip.offset);
          const gain = new Tone.Volume(clip.gainDb).connect(ownDelay);
          const player = new Tone.Player({ fadeIn: clip.fadeIn, fadeOut: clip.fadeOut });
          player.connect(gain);
          if (clip.loopLength && clip.loopLength > 0) {
            player.loop = true;
            player.loopStart = clip.sourceOffset;
            player.loopEnd = clip.sourceOffset + clip.loopLength;
          }
          loadPromises.push(
            player.load(clip.url).then(() => {
              try {
                player.start(clip.offset, clip.sourceOffset, playLength);
              } catch {
                // clip runs past the render window or similar - skip it
              }
            })
          );
        });
      }
    });

    // Each strip into the track it feeds, or the master.
    const builtIds = new Map(compensation.channels.map((c) => [c.id, c]));
    const destOf = (id: string) => {
      const dest = routes.get(id) ?? null;
      return dest && builtIds.has(dest) ? dest : null;
    };
    compensation.channels.forEach((c) => {
      const dest = destOf(c.id);
      c.strip.connect(dest ? builtIds.get(dest)!.routeIn : direct);
    });

    const plan = planCompensation({
      enabled: params.delayCompensation ?? true,
      channels: compensation.channels.map((c) => ({ id: c.id, latency: c.latency, live: false, dest: destOf(c.id) })),
      buses: compensation.buses,
      master: masterLatency + (masterLimiter ? nodeLatency(masterLimiter) : 0),
    });
    compensation.channels.forEach((c) => {
      c.pdc.delayTime.value = plan.channel.get(c.id) ?? 0;
      c.own.delayTime.value = plan.own.get(c.id) ?? 0;
      c.send.delayTime.value = plan.send.get(c.id) ?? 0;
    });
    compensation.buses.forEach((b) => (b.pdc.delayTime.value = plan.bus.get(b.id) ?? 0));
    direct.delayTime.value = plan.direct;
    latency = plan.total;

    // Sidechains: tap -> alignment delay -> the effect's key input.
    hosts.push({ id: "master", built: masterBuilt });
    const snapshot: RoutingSnapshot = {
      channels: compensation.channels.map((c) => ({
        id: c.id,
        sends: sendsOf.get(c.id) ?? [],
        chain: c.latency,
        pdc: plan.channel.get(c.id) ?? 0,
        toMaster: plan.direct,
        dest: destOf(c.id),
        start: plan.own.get(c.id) ?? 0,
        send: plan.send.get(c.id) ?? 0,
      })),
      buses: compensation.buses.map((b) => ({ id: b.id, chain: b.latency, pdc: plan.bus.get(b.id) ?? 0 })),
    };
    const isKeyed = (node: Tone.ToneAudioNode): node is Tone.ToneAudioNode & { sidechainInput: Tone.Gain; setSidechainActive(on: boolean): void } =>
      "sidechainInput" in node;
    const requests: SidechainRequest[] = hosts.flatMap((h) =>
      h.built.filter(({ fx, node }) => fx.sidechain && isKeyed(node)).map(({ fx }) => ({ hostId: h.id, effectId: fx.id, routing: fx.sidechain }))
    );
    const accepted = resolveSidechains(snapshot, requests);
    hosts.forEach((h) => {
      let before = 0;
      h.built.forEach(({ fx, node }) => {
        const source = accepted.get(fx.id);
        if (source && fx.sidechain && isKeyed(node)) {
          const tap = taps.get(source)?.[fx.sidechain.tap];
          if (tap) {
            const delay = new Tone.Delay(keyDelay(snapshot, h.id, before, source, fx.sidechain.tap), MAX_COMPENSATION);
            tap.connect(delay);
            delay.connect(node.sidechainInput);
            node.setSidechainActive(true);
          }
        }
        if (!fx.bypass) before += nodeLatency(node);
      });
    });

    if (automationEntries.length > 0) {
      // Offline rendering is non-realtime, so a scheduled callback's own
      // `time` argument (the sample-accurate instant this tick represents)
      // is what must be used to schedule the change - setting `.value`
      // directly instead (which stamps it at the live `context.currentTime`,
      // meaningless during a deterministic offline render) desyncs the
      // automation from the audio entirely. Only volume/pan are true
      // Tone.Param/Signal objects that support this; an automated effect
      // param falls back to an immediate set, which is fine for live
      // playback (see audioEngine.ts's `ensureAutomationLoop`) but won't be
      // perfectly sample-accurate in a bounce.
      Tone.getTransport().scheduleRepeat((time) => {
        // The transport starts at context time 0 with no tempo automation
        // of its own, so the callback's own `time` (the tick's real,
        // sample-accurate instant) doubles as elapsed transport seconds -
        // reading `Tone.getTransport().seconds` here instead would reflect
        // whatever moment the offline scheduler happened to run this JS
        // callback in its own internal precomputation pass, not the audio
        // instant this tick actually represents.
        const t = time;
        automationEntries.forEach(({ lane, strip, effectNodesById }) => {
          const value = interpolateAutomation(lane.points, t);
          if (value === null) return;
          if (lane.target.kind === "volume") strip.volume.setValueAtTime(value, time);
          else if (lane.target.kind === "pan") strip.pan.setValueAtTime(value, time);
          else {
            const effect = effectNodesById.get(lane.target.effectId);
            if (effect) applyEffectParam(effect.node, effect.type, lane.target.paramKey, value);
          }
        });
      }, 0.05);
      Tone.getTransport().start();
    }

    // Worklet-based effects (every limiter, pitch shifters) only join the
    // graph once their module loads in this offline context.
    await Promise.all([...loadPromises, ...files.loads, workletsReady(Tone.getContext())]);
  }, duration);

  const raw = buffer.get();
  if (!raw) throw new Error("Offline render produced no audio buffer");
  // The mix comes out `latency` late: trim that off (and anything before
  // the range) so the file starts on the downbeat, and drop the spare room
  // at the end. Every stem is trimmed by its own latency, so they all line
  // up with the mix.
  const start = Math.round((latency + rangeStart) * raw.sampleRate);
  const frames = Math.round((renderEnd - rangeStart) * raw.sampleRate);
  const length = Math.max(0, Math.min(frames, raw.length - start));
  const channels = Array.from({ length: raw.numberOfChannels }, (_, ch) => raw.getChannelData(ch).slice(start, start + length));
  return { channels, sampleRate: raw.sampleRate };
}

export function downloadWavBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/\s+/g, "-").toLowerCase() || "project"}.wav`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
