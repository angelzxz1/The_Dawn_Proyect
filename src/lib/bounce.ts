// Renders the whole project to a WAV file using Tone.Offline - a second,
// throwaway audio graph built the same way the live engine builds its
// channels, rendered faster than real time, with no audible side effects on
// the real engine or speakers.

import * as Tone from "tone";
import { createInstrument, createEffectNode, applyEffectParam } from "./audioEngine";
import type { ChannelConfig, ClipInstance, MidiClipInstance } from "./types";
import type { EffectInstance } from "./effects";

const MIN_NOTE_DURATION = 0.05;
const TAIL_SECONDS = 2; // extra render time so reverb/delay tails aren't cut off

export interface BounceParams {
  channels: ChannelConfig[];
  clipsByChannel: Record<string, ClipInstance[]>;
  channelEffects: Record<string, EffectInstance[]>;
  masterVolume: number;
  masterPan: number;
  masterLimiterThreshold: number;
  /** Where the last bit of content ends, in seconds - the render runs a
   * couple of seconds past this for effect tails. */
  contentEndSeconds: number;
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

    const loadPromises: Promise<void>[] = [];

    audible.forEach((channel) => {
      const strip = new Tone.Channel({ volume: channel.volume, pan: channel.pan }).connect(master);
      const effects = (params.channelEffects[channel.id] ?? []).map((fx) => ({
        fx,
        node: createEffectNode(fx.type, fx.params),
      }));
      effects.forEach((e) =>
        Object.entries(e.fx.params).forEach(([key, value]) => applyEffectParam(e.node, e.fx.type, key, value))
      );
      const firstEffect = effects[0]?.node ?? strip;
      for (let i = 0; i < effects.length; i++) {
        const next = effects[i + 1]?.node ?? strip;
        effects[i].node.connect(next);
      }

      const clips = params.clipsByChannel[channel.id] ?? [];

      if (channel.type === "midi") {
        const instrument = createInstrument(channel.instrument, () => {});
        instrument.connect(firstEffect);
        const flattened = clips
          .filter(isMidiClip)
          .flatMap((clip) => clip.notes.map((n) => ({ ...n, time: clip.offset + n.time })));
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
          const player = new Tone.Player();
          player.connect(firstEffect);
          loadPromises.push(
            player.load(clip.url).then(() => {
              try {
                player.start(clip.offset, 0, clip.length);
              } catch {
                // clip runs past the render window or similar - skip it
              }
            })
          );
        });
      }
    });

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
