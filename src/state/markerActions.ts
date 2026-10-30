// The song's section markers (markers.ts): adding, naming, moving and
// removing them, each one undo step.

import { addMarker, cleanMarkerName, moveMarker, suggestMarkerName, type SongMarker } from "@/project/markers";
import { newMarkerId } from "./ids";
import { projectStore } from "./projectStore";

function change(next: SongMarker[] | null): boolean {
  if (!next) return false;
  projectStore.push();
  projectStore.set("markers", next);
  return true;
}

export const markerActions = {
  /** A marker at `beat` (named `name`, or what comes next in a song), unless
   * there's one there already. Returns its id. */
  add(beat: number, name?: string): string | null {
    const markers = projectStore.get().markers;
    const marker = { id: newMarkerId(), beat: Math.max(0, beat), name: cleanMarkerName(name ?? "") || suggestMarkerName(markers) };
    return change(addMarker(markers, marker)) ? marker.id : null;
  },

  /** A blank name leaves it as it was. */
  rename(id: string, name: string): boolean {
    const clean = cleanMarkerName(name);
    const markers = projectStore.get().markers;
    if (!clean || !markers.some((m) => m.id === id && m.name !== clean)) return false;
    return change(markers.map((m) => (m.id === id ? { ...m, name: clean } : m)));
  },

  /** Not onto another marker. */
  move(id: string, beat: number): boolean {
    const markers = projectStore.get().markers;
    if (markers.find((m) => m.id === id)?.beat === beat) return false;
    return change(moveMarker(markers, id, beat));
  },

  remove(id: string): boolean {
    const markers = projectStore.get().markers;
    if (!markers.some((m) => m.id === id)) return false;
    return change(markers.filter((m) => m.id !== id));
  },
};
