// Song sections (Logic's arrangement markers): named points on the
// timeline - Intro, Verse, Chorus - that you can jump to and loop. A
// section runs from its marker to the next one (the last, to the song's
// end). Kept in beats like the loop, so they stay on their bars when the
// tempo changes, and saved with the project as part of the song (undo
// covers them).

export interface SongMarker {
  id: string;
  /** Beats (quarter notes) from the start of the song. */
  beat: number;
  name: string;
}

/** The names offered for a section. */
export const SECTION_NAMES = ["Intro", "Verse", "Pre-Chorus", "Chorus", "Bridge", "Breakdown", "Drop", "Outro"];

/** What a new marker is called, going by how many there are: a common song
 * form, then numbered. */
const SONG_FORM = ["Intro", "Verse", "Chorus", "Verse", "Chorus", "Bridge", "Chorus", "Outro"];

export const MAX_MARKER_NAME = 40;

/** Two markers this close (in beats) are at the same place. */
const EPS = 1e-6;

export function suggestMarkerName(markers: readonly SongMarker[]): string {
  return SONG_FORM[markers.length] ?? `Section ${markers.length + 1}`;
}

/** A name as kept: trimmed and not too long; blank is no name. */
export function cleanMarkerName(name: string): string {
  return name.trim().slice(0, MAX_MARKER_NAME);
}

const byBeat = (a: SongMarker, b: SongMarker) => a.beat - b.beat;

/** In order, one per place (the first wins), each with a name. */
export function normalizeMarkers(raw: unknown): SongMarker[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  const out: SongMarker[] = [];
  raw.forEach((m, i) => {
    if (!m || typeof m !== "object") return;
    const r = m as Record<string, unknown>;
    if (typeof r.beat !== "number" || !Number.isFinite(r.beat) || r.beat < 0) return;
    let id = typeof r.id === "string" && r.id ? r.id : `mark-${i + 1}`;
    while (ids.has(id)) id = `${id}-1`;
    if (out.some((o) => Math.abs(o.beat - (r.beat as number)) < EPS)) return;
    ids.add(id);
    const name = typeof r.name === "string" ? cleanMarkerName(r.name) : "";
    out.push({ id, beat: r.beat, name: name || `Section ${out.length + 1}` });
  });
  return out.sort(byBeat);
}

/** The markers with one added, or null when one is already there. */
export function addMarker(markers: readonly SongMarker[], marker: SongMarker): SongMarker[] | null {
  if (markers.some((m) => Math.abs(m.beat - marker.beat) < EPS)) return null;
  return [...markers, marker].sort(byBeat);
}

/** The markers with one moved, or null when another is already there. */
export function moveMarker(markers: readonly SongMarker[], id: string, beat: number): SongMarker[] | null {
  const to = Math.max(0, beat);
  if (markers.some((m) => m.id !== id && Math.abs(m.beat - to) < EPS)) return null;
  return markers.map((m) => (m.id === id ? { ...m, beat: to } : m)).sort(byBeat);
}

/** The section a marker starts: to the next marker, or to `songEnd` (in
 * beats) for the last one (at least a bar, if the song ends before it). */
export function sectionOf(markers: readonly SongMarker[], id: string, songEnd: number, beatsPerBar: number): { start: number; end: number } | null {
  const i = markers.findIndex((m) => m.id === id);
  if (i < 0) return null;
  const start = markers[i].beat;
  const next = markers[i + 1];
  return { start, end: next ? next.beat : Math.max(songEnd, start + beatsPerBar) };
}

/** The marker after `beat`, if any. */
export function nextMarker(markers: readonly SongMarker[], beat: number): SongMarker | null {
  return markers.find((m) => m.beat > beat + EPS) ?? null;
}

/** The marker before `beat`, if any. Within `grace` beats after a marker
 * (just jumped there, or playing on from it) goes to the one before it. */
export function previousMarker(markers: readonly SongMarker[], beat: number, grace = 0): SongMarker | null {
  return markers.findLast((m) => m.beat < beat - Math.max(EPS, grace)) ?? null;
}
