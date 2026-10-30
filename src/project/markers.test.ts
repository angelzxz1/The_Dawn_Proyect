import { describe, expect, it } from "vitest";
import { addMarker, moveMarker, nextMarker, normalizeMarkers, previousMarker, sectionOf, suggestMarkerName, type SongMarker } from "./markers";

const m = (id: string, beat: number, name = id): SongMarker => ({ id, beat, name });
const song = [m("intro", 0, "Intro"), m("verse", 16, "Verse"), m("chorus", 48, "Chorus")];

describe("section markers", () => {
  it("suggests a song form, then numbers", () => {
    expect(suggestMarkerName([])).toBe("Intro");
    expect(suggestMarkerName(song)).toBe("Verse");
    expect(suggestMarkerName(Array.from({ length: 8 }, (_, i) => m(`m${i}`, i * 4)))).toBe("Section 9");
  });

  it("keeps them in order, one per place, and drops broken ones", () => {
    expect(
      normalizeMarkers([
        { id: "b", beat: 16, name: "  Verse  " },
        { id: "a", beat: 0, name: "Intro" },
        { id: "c", beat: 16, name: "Again" },
        { id: "a", beat: 32, name: "" },
        { beat: -4, name: "Before" },
        { beat: "x" },
        null,
      ])
    ).toEqual([m("a", 0, "Intro"), m("b", 16, "Verse"), m("a-1", 32, "Section 3")]);
    expect(normalizeMarkers(undefined)).toEqual([]);
  });

  it("adds and moves one, but not onto another", () => {
    expect(addMarker(song, m("bridge", 32))?.map((x) => x.id)).toEqual(["intro", "verse", "bridge", "chorus"]);
    expect(addMarker(song, m("again", 16))).toBeNull();
    expect(moveMarker(song, "intro", 64)?.map((x) => x.id)).toEqual(["verse", "chorus", "intro"]);
    expect(moveMarker(song, "intro", 48)).toBeNull();
    expect(moveMarker(song.slice(1), "verse", -3)?.[0]).toEqual(m("verse", 0, "Verse"));
  });

  it("runs a section to the next marker, the last to the song's end", () => {
    expect(sectionOf(song, "verse", 80, 4)).toEqual({ start: 16, end: 48 });
    expect(sectionOf(song, "chorus", 80, 4)).toEqual({ start: 48, end: 80 });
    // A song that ends before its last marker: a bar of it.
    expect(sectionOf(song, "chorus", 20, 4)).toEqual({ start: 48, end: 52 });
    expect(sectionOf(song, "gone", 80, 4)).toBeNull();
  });

  it("finds the markers around a place", () => {
    expect(nextMarker(song, 0)?.id).toBe("verse");
    expect(nextMarker(song, 20)?.id).toBe("chorus");
    expect(nextMarker(song, 48)).toBeNull();
    expect(previousMarker(song, 16)?.id).toBe("intro");
    expect(previousMarker(song, 17)?.id).toBe("verse");
    // Playing on just past a marker: back to the one before it.
    expect(previousMarker(song, 16.5, 1)?.id).toBe("intro");
    expect(previousMarker(song, 0)).toBeNull();
  });
});
