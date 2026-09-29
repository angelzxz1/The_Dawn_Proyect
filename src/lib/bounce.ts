// Renders the whole project to a WAV file using Tone.Offline - a second,
// throwaway audio graph built the same way the live engine builds its
// channels, rendered faster than real time, with no audible side effects on
// the real engine or speakers.

import * as Tone from "tone";
import { createInstrument, createEffectNode, applyEffectParam, IrLoaderChain } from "./audioEngine";
import { decodeEffectFileAudio, readEffectFileText, referencedEffectFiles } from "./effectFiles";
import { NamAmpChain } from "./namAmp";
import { SynthInstrument } from "./synth";
import { notesWithinClip } from "./project";
import { workletsReady } from "./workletLoader";
import { chainLatency, nodeLatency, planCompensation } from "./latency";
import { keyDelay, resolveSidechains, type RoutingSnapshot, type SidechainRequest } from "./sidechainRouting";
import type { SidechainTap } from "./sidechainModel";
import { encodeWav } from "./wav";
import type { BusConfig, ChannelConfig, ClipInstance, MidiClipInstance } from "./types";
import type { EffectInstance } from "./effects";

const MIN_NOTE_DURATION = 0.05;
const TAIL_SECONDS = 2; // extra render time so reverb/delay tails aren't cut off

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

/** Renders the project offline and resolves with a WAV file Blob. */
export async function bounceProjectToWav(params: BounceParams): Promise<Blob> {
  // Room for the mix's own latency, which is trimmed off the front after.
  const duration = Math.max(1, params.contentEndSeconds + TAIL_SECONDS) + MAX_COMPENSATION;
  let latency = 0;

  // Only the channels that would actually be heard in the real mix: if any
  // channel is soloed, everything else is silent; otherwise muted channels
  // are simply left out of the render.
  const soloed = params.channels.filter((c) => c.solo);
  const audible = new Set(soloed.length > 0 ? soloed : params.channels.filter((c) => !c.muted));
  // A track keying a sidechain is rendered even when it isn't heard (a
  // muted "ghost" kick ducking the bass), with its strip muted as it is in
  // playback.
  const keySources = new Set(
    [params.masterEffects, ...Object.values(params.busEffects), ...Object.values(params.channelEffects)]
      .flat()
      .map((fx) => (fx.sidechain?.on ? fx.sidechain.source : null))
  );
  const rendered = params.channels.filter((c) => audible.has(c) || keySources.has(c.id));

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
    const masterLimiter = createEffectNode("limiter", {
      threshold: params.masterLimiterThreshold,
      gain: 0,
      release: 0.1,
      softClip: 0,
    }).connect(masterMeter);
    masterMeter.toDestination();
    // channelCount: 2 on every Channel here - see audioEngine.ts's
    // addChannel for why: Tone.Channel's Panner defaults to explicit
    // mono, silently folding any stereo content (a stereo delay, etc.)
    // down before panning, at each stage it passes through.
    const master = new Tone.Channel({ volume: params.masterVolume, pan: params.masterPan, channelCount: 2 });
    const { entry: masterEntry, latency: masterLatency, built: masterBuilt } = buildOfflineEffectsChain(params.masterEffects, masterLimiter, files);
    master.connect(masterEntry);

    // Delay compensation, as the live engine does it (see latency.ts).
    const direct = new Tone.Delay(0, MAX_COMPENSATION).connect(master);
    const compensation: { channels: { id: string; latency: number; pdc: Tone.Delay }[]; buses: typeof compensation.channels } = {
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
      const strip = new Tone.Channel({ volume: channel.volume, pan: channel.pan, channelCount: 2, mute: !audible.has(channel) }).connect(direct);
      const pdc = new Tone.Delay(0, MAX_COMPENSATION).connect(strip);
      const sends: string[] = [];
      Object.entries(channel.sends ?? {}).forEach(([busId, db]) => {
        const bus = buses.get(busId);
        if (!bus) return;
        const send = new Tone.Gain(Tone.dbToGain(db));
        strip.connect(send);
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
      // Sources go into the pre-FX tap, which feeds the chain.
      const firstNode = new Tone.Gain().connect(entry);
      compensation.channels.push({ id: channel.id, latency: trackLatency, pdc });
      taps.set(channel.id, { preFx: firstNode, postFx, postFader: strip });
      hosts.push({ id: channel.id, built });

      (channel.automationLanes ?? []).forEach((lane) => {
        automationEntries.push({ lane, strip, effectNodesById: nodesById });
      });

      const clips = params.clipsByChannel[channel.id] ?? [];

      if (channel.type === "midi") {
        const instrument = createInstrument(channel.instrument, () => {}, channel.synthParams);
        instrument.connect(firstNode);
        const flattened = clips
          .filter(isMidiClip)
          .flatMap((clip) => notesWithinClip(clip).map((n) => ({ ...n, time: clip.offset + n.time })));
        // Notes are scheduled once the instrument's samples (if any) have
        // loaded - Tone.Offline awaits every promise pushed here before it
        // starts rendering.
        loadPromises.push(
          (async () => {
            await new Promise<void>((resolve) => {
              if (instrument instanceof Tone.Sampler) {
                const check = () => (instrument.loaded ? resolve() : setTimeout(check, 10));
                check();
              } else if (instrument instanceof SynthInstrument) {
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
          const gain = new Tone.Volume(clip.gainDb).connect(firstNode);
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
                player.start(clip.offset, clip.sourceOffset, clip.length);
              } catch {
                // clip runs past the render window or similar - skip it
              }
            })
          );
        });
      }
    });

    const plan = planCompensation({
      enabled: params.delayCompensation ?? true,
      channels: compensation.channels.map((c) => ({ id: c.id, latency: c.latency, live: false })),
      buses: compensation.buses,
      master: masterLatency + nodeLatency(masterLimiter),
    });
    compensation.channels.forEach((c) => (c.pdc.delayTime.value = plan.channel.get(c.id) ?? 0));
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
  // The mix comes out `latency` late: trim that off so the file starts on
  // the downbeat, and drop the spare room at the end.
  const start = Math.round(latency * raw.sampleRate);
  const frames = Math.round(Math.max(1, params.contentEndSeconds + TAIL_SECONDS) * raw.sampleRate);
  const length = Math.min(frames, raw.length - start);
  const channels = Array.from({ length: raw.numberOfChannels }, (_, ch) => raw.getChannelData(ch).subarray(start, start + length));
  return encodeWav(channels, raw.sampleRate, 16);
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
