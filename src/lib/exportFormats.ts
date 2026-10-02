// The pieces of exporting that don't need audio hardware: export settings,
// peak normalization, sample conversion for the MP3 encoder, the MP3's
// ID3 tag, and stem file names.

export type ExportFormat = "wav" | "mp3";
export type WavBits = 16 | 24;
export const MP3_BITRATES = [128, 192, 320] as const;
export type Mp3Bitrate = (typeof MP3_BITRATES)[number];
export const TAIL_CHOICES = [0, 1, 2, 4, 8] as const;

export interface ExportSettings {
  what: "mix" | "stems";
  format: ExportFormat;
  wavBits: WavBits;
  mp3Kbps: Mp3Bitrate;
  range: "song" | "loop";
  /** Seconds of effect tail after the end. */
  tail: number;
  /** Raise (or lower) the mix so its peak sits at NORMALIZE_PEAK_DB. Mix only. */
  normalize: boolean;
  /** Stems only: run the master effects and limiter on each stem. */
  stemMasterFx: boolean;
}

export const DEFAULT_EXPORT: ExportSettings = {
  what: "mix",
  format: "wav",
  wavBits: 24,
  mp3Kbps: 320,
  range: "song",
  tail: 2,
  normalize: false,
  stemMasterFx: false,
};

/** Where normalization puts the peak: a little under full scale, since MP3
 * encoding can overshoot it. */
export const NORMALIZE_PEAK_DB = -1;

const SETTINGS_KEY = "dawn.export";

export function normalizeExportSettings(raw: unknown): ExportSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_EXPORT;
  return {
    what: r.what === "stems" ? "stems" : "mix",
    format: r.format === "mp3" ? "mp3" : "wav",
    wavBits: r.wavBits === 16 ? 16 : d.wavBits,
    mp3Kbps: MP3_BITRATES.includes(r.mp3Kbps as Mp3Bitrate) ? (r.mp3Kbps as Mp3Bitrate) : d.mp3Kbps,
    range: r.range === "loop" ? "loop" : "song",
    tail: TAIL_CHOICES.includes(r.tail as (typeof TAIL_CHOICES)[number]) ? (r.tail as number) : d.tail,
    normalize: typeof r.normalize === "boolean" ? r.normalize : d.normalize,
    stemMasterFx: typeof r.stemMasterFx === "boolean" ? r.stemMasterFx : d.stemMasterFx,
  };
}

/** The last export's settings, remembered in this browser. */
export function loadExportSettings(): ExportSettings {
  try {
    return normalizeExportSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null"));
  } catch {
    return { ...DEFAULT_EXPORT };
  }
}

export function saveExportSettings(s: ExportSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Not remembering them is fine.
  }
}

export function peakOf(channels: Float32Array[]): number {
  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  return peak;
}

/** Scales the audio in place so its peak sits at `targetDb`; silence is left alone. Returns the gain applied. */
export function normalizePeak(channels: Float32Array[], targetDb = NORMALIZE_PEAK_DB): number {
  const peak = peakOf(channels);
  if (peak < 1e-6) return 1;
  const gain = Math.pow(10, targetDb / 20) / peak;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= gain;
  return gain;
}

/** Float samples (-1..1, clipped) as 16-bit integers, for the MP3 encoder. */
export function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    out[i] = v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff);
  }
  return out;
}

/** The sample rates an MP3 can have. */
export const MP3_SAMPLE_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

// --- ID3v2.3 tag ---

function utf16Frame(id: string, payload: number[]): number[] {
  const size = payload.length;
  return [...id].map((c) => c.charCodeAt(0)).concat([(size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff, 0, 0], payload);
}

/** UTF-16 with a byte-order mark, as ID3v2.3 text frames want it. */
function utf16(text: string): number[] {
  const out = [0xff, 0xfe];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    out.push(code & 0xff, code >> 8);
  }
  return out;
}

function textFrame(id: string, text: string): number[] {
  return utf16Frame(id, [1, ...utf16(text)]);
}

/** An ID3v2.3 tag with the title, the encoder ("The Dawn Project") and a
 * "Made with The Dawn Project" comment, to put in front of the MP3 frames. */
export function id3Tag({ title, software, comment }: { title: string; software: string; comment: string }): Uint8Array {
  const frames = [
    ...textFrame("TIT2", title),
    ...textFrame("TSSE", software),
    // COMM: encoding, language, empty short description, the comment.
    ...utf16Frame("COMM", [1, ..."eng"].map((c) => (typeof c === "string" ? c.charCodeAt(0) : c)).concat([0xff, 0xfe, 0, 0], utf16(comment))),
  ];
  const size = frames.length;
  // The tag size is "syncsafe": 7 bits per byte.
  const header = [0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f];
  return new Uint8Array([...header, ...frames]);
}

// --- file names ---

/** A file name safe on every system: no path characters, trimmed, never empty. */
export function safeFileName(name: string, fallback = "Untitled"): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim();
  return cleaned || fallback;
}

/** "Song Name - Guitar.wav", numbered when two tracks share a name. */
export function stemFileNames(song: string, tracks: string[], ext: string): string[] {
  const base = safeFileName(song);
  const used = new Map<string, number>();
  return tracks.map((t) => {
    const name = `${base} - ${safeFileName(t, "Track")}`;
    const n = (used.get(name.toLowerCase()) ?? 0) + 1;
    used.set(name.toLowerCase(), n);
    return `${n > 1 ? `${name} (${n})` : name}.${ext}`;
  });
}
