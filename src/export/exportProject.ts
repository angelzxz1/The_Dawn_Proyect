// Turns an export dialog's settings into a file: the mix (or the loop
// region of it) as WAV or MP3, or one file per track ("stems") in a ZIP,
// all rendered by bounce.ts so delay compensation, sends and buses behave
// exactly as in playback.

import { zipSync } from "fflate";
import { audibleChannels, renderProject, type BounceParams, type RenderedAudio } from "./bounce";
import { routeMap, upstreamOf } from "../engine/routing";
import { encodeWav } from "./wav";
import { encodeMp3 } from "./mp3";
import { normalizePeak, safeFileName, stemFileNames, type ExportSettings } from "./exportFormats";

export interface ExportStatus {
  label: string;
  /** 0..1 overall. */
  fraction: number;
}

export interface ExportResult {
  blob: Blob;
  fileName: string;
  /** How many files it holds (1 for a mix). */
  files: number;
}

export class ExportCancelled extends Error {
  constructor() {
    super("Export cancelled");
  }
}

async function encode(audio: RenderedAudio, s: ExportSettings, title: string, onProgress: (f: number) => void): Promise<Blob> {
  if (s.format === "mp3") return encodeMp3(audio.channels, audio.sampleRate, s.mp3Kbps, title, onProgress);
  onProgress(1);
  return encodeWav(audio.channels, audio.sampleRate, s.wavBits);
}

/** The tracks that get a stem: the ones heard in the mix that go to the
 * master (a group's stem includes its members) and have something on them,
 * or routed into them. */
export function stemTracks(params: BounceParams): { id: string; name: string }[] {
  const routes = routeMap(params.channels);
  const heard = new Set(audibleChannels(params.channels).map((c) => c.id));
  const hasClips = (id: string) => heard.has(id) && (params.clipsByChannel[id] ?? []).length > 0;
  return params.channels
    .filter((c) => heard.has(c.id) && !routes.get(c.id))
    .filter((c) => hasClips(c.id) || [...upstreamOf(c.id, routes)].some(hasClips))
    .map((c) => ({ id: c.id, name: c.name }));
}

export async function exportProject(
  params: BounceParams,
  settings: ExportSettings,
  options: { songName: string; loop?: { start: number; end: number }; onStatus: (s: ExportStatus) => void; cancelled?: () => boolean }
): Promise<ExportResult> {
  const { songName, onStatus, cancelled = () => false } = options;
  const range = settings.range === "loop" && options.loop ? options.loop : undefined;
  const render = { start: range?.start, end: range?.end, tailSeconds: settings.tail };
  const ext = settings.format;
  const title = safeFileName(songName);
  const check = () => {
    if (cancelled()) throw new ExportCancelled();
  };

  if (settings.what === "mix") {
    onStatus({ label: "Rendering the mix…", fraction: 0.05 });
    const audio = await renderProject(params, render);
    check();
    if (settings.normalize) normalizePeak(audio.channels);
    onStatus({ label: settings.format === "mp3" ? "Encoding the MP3…" : "Writing the WAV…", fraction: 0.6 });
    const blob = await encode(audio, settings, title, (f) => onStatus({ label: "Encoding the MP3…", fraction: 0.6 + 0.4 * f }));
    return { blob, fileName: `${title}.${ext}`, files: 1 };
  }

  const tracks = stemTracks(params);
  if (tracks.length === 0) throw new Error("There's nothing to export: no track that would be heard has any clips.");
  const names = stemFileNames(songName, tracks.map((t) => t.name), ext);
  const files: Record<string, Uint8Array> = {};
  for (let i = 0; i < tracks.length; i++) {
    check();
    const base = i / tracks.length;
    const step = 1 / tracks.length;
    onStatus({ label: `Rendering ${tracks[i].name} (${i + 1} of ${tracks.length})…`, fraction: base });
    const audio = await renderProject(params, { ...render, only: tracks[i].id, masterChain: settings.stemMasterFx });
    check();
    const blob = await encode(audio, settings, `${title} - ${tracks[i].name}`, (f) =>
      onStatus({ label: `Encoding ${tracks[i].name} (${i + 1} of ${tracks.length})…`, fraction: base + step * (0.6 + 0.4 * f) })
    );
    files[names[i]] = new Uint8Array(await blob.arrayBuffer());
  }
  check();
  onStatus({ label: "Packing the ZIP…", fraction: 0.99 });
  // Stored, not compressed: audio barely shrinks and this keeps it fast.
  const zip = zipSync(files, { level: 0 });
  return { blob: new Blob([zip as Uint8Array<ArrayBuffer>], { type: "application/zip" }), fileName: `${title} - Stems.zip`, files: tracks.length };
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
