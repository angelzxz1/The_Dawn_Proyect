// Renders the whole project to a WAV file using Tone.Offline - a second,
// throwaway audio graph built the same way the live engine builds its
// channels, rendered faster than real time, with no audible side effects on
// the real engine or speakers.

import * as Tone from "tone";
import { createInstrument, createEffectNode, applyEffectParam } from "./audioEngine";
import { notesWithinClip } from "./project";
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
  /** Where the last bit of content ends, in seconds - the render runs a
   * couple of seconds past this for effect tails. */
  contentEndSeconds: number;
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
function buildOfflineEffectsChain(
  effects: EffectInstance[],
  dest: Tone.ToneAudioNode
): { entry: Tone.ToneAudioNode; nodesById: Map<string, { node: Tone.ToneAudioNode; type: EffectInstance["type"] }> } {
  const built = effects.map((fx) => ({ fx, node: createEffectNode(fx.type, fx.params) }));
  built.forEach(({ fx, node }) =>
    Object.entries(fx.params).forEach(([key, value]) => applyEffectParam(node, fx.type, key, value))
  );
  const active = built.filter(({ fx }) => !fx.bypass);
  for (let i = 0; i < active.length; i++) {
    const next = active[i + 1]?.node ?? dest;
    active[i].node.connect(next);
  }
  const nodesById = new Map(built.map(({ fx, node }) => [fx.id, { node, type: fx.type }]));
  return { entry: active[0]?.node ?? dest, nodesById };
}

function isMidiClip(c: ClipInstance): c is MidiClipInstance {
  return c.kind === "midi";
}

/** Renders the project offline and resolves with a WAV file Blob. */
export async function bounceProjectToWav(params: BounceParams): Promise<Blob> {
  const duration = Math.max(1, params.contentEndSeconds + TAIL_SECONDS);

  // Only the channels that would actually be heard in the real mix: if any
  // channel is soloed, everything else is silent; otherwise muted channels
  // are simply left out of the render.
  const soloed = params.channels.filter((c) => c.solo);
  const audible = soloed.length > 0 ? soloed : params.channels.filter((c) => !c.muted);

  const buffer = await Tone.Offline(async () => {
    const masterMeter = new Tone.Meter();
    const masterLimiter = new Tone.Limiter(params.masterLimiterThreshold).connect(masterMeter);
    masterMeter.toDestination();
    const master = new Tone.Channel({ volume: params.masterVolume, pan: params.masterPan }).connect(
      masterLimiter
    );

    const buses = new Map<string, { input: Tone.Gain }>();
    params.buses.forEach((bus) => {
      const input = new Tone.Gain(1);
      const channel = new Tone.Channel({ volume: 0, pan: 0 }).connect(master);
      const { entry } = buildOfflineEffectsChain(params.busEffects[bus.id] ?? [], channel);
      input.connect(entry);
      buses.set(bus.id, { input });
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

    audible.forEach((channel) => {
      const strip = new Tone.Channel({ volume: channel.volume, pan: channel.pan }).connect(master);
      Object.entries(channel.sends ?? {}).forEach(([busId, db]) => {
        const bus = buses.get(busId);
        if (!bus) return;
        const send = new Tone.Gain(Tone.dbToGain(db));
        strip.connect(send);
        send.connect(bus.input);
      });
      const { entry: firstNode, nodesById } = buildOfflineEffectsChain(
        params.channelEffects[channel.id] ?? [],
        strip
      );

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

    await Promise.all(loadPromises);
  }, duration);

  const raw = buffer.get();
  if (!raw) throw new Error("Offline render produced no audio buffer");
  return audioBufferToWav(raw);
}

/** Encodes a Web Audio AudioBuffer as a 16-bit PCM WAV file. */
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const bufferLength = 44 + dataSize;

  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const channelData = Array.from({ length: numChannels }, (_, i) => buffer.getChannelData(i));
  let offset = 44;
  for (let frame = 0; frame < numFrames; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][frame]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
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
