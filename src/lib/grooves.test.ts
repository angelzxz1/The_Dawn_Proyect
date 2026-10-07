import { describe, expect, it } from "vitest";
import { FACTORY_KITS } from "../instruments/drum-rack/drumKits";
import { GROOVE_GENRES, GROOVE_SECTIONS, GROOVES, grooveBeats, grooveHits, grooveKit, grooveNotes, stepsPerBar } from "./grooves";

describe("groove library", () => {
  it("has every section for every genre, at least twelve genres", () => {
    expect(GROOVE_GENRES.length).toBeGreaterThanOrEqual(12);
    expect(GROOVES).toHaveLength(GROOVE_GENRES.length * GROOVE_SECTIONS.length);
    expect(new Set(GROOVES.map((g) => g.id)).size).toBe(GROOVES.length);
  });

  it("every lane fills whole bars, and every groove plays", () => {
    for (const g of GROOVES) {
      const per = stepsPerBar(g.genre);
      for (const [role, lane] of Object.entries(g.lanes)) {
        const n = (lane ?? "").replace(/[|\s]/g, "").length;
        expect(n % per, `${g.id} ${role}: ${n} steps isn't whole ${per}-step bars`).toBe(0);
        expect(n / per, `${g.id} ${role} is shorter than the groove`).toBe(g.bars);
        expect(/^[.\-xXog|\s]*$/.test(lane ?? ""), `${g.id} ${role} has a stray character`).toBe(true);
      }
      expect(grooveHits(g).length, g.id).toBeGreaterThan(0);
      expect(grooveHits(g).every((h) => h.beat >= 0 && h.beat < grooveBeats(g)), g.id).toBe(true);
    }
  });

  it("plays on the drum pads (C1-D#2), in time at the given tempo", () => {
    const verse = GROOVES.find((g) => g.id === "rock-verse")!;
    const notes = grooveNotes(verse, 120);
    // A kick on the downbeat, a snare on beat 2 (0.5 s at 120 BPM).
    expect(notes[0]).toMatchObject({ note: "C1", time: 0 });
    expect(notes.find((n) => n.note === "D1")?.time).toBeCloseTo(0.5, 6);
    expect(Math.max(...notes.map((n) => n.time))).toBeLessThan(4); // two bars
    const swung = GROOVES.find((g) => g.id === "hiphop-verse")!;
    const offbeat = grooveNotes(swung, 60).find((n) => n.note === "C1" && n.time > 1.7 && n.time < 1.9);
    expect(offbeat?.time).toBeCloseTo(1.75 + 0.12 * 0.25, 6); // the kick on the "a" of 2, swung
  });

  it("names a kit that exists for every genre", () => {
    const names = new Set(FACTORY_KITS.map((k) => k.name));
    for (const genre of GROOVE_GENRES) expect(names.has(genre.kit), genre.kit).toBe(true);
    expect(grooveKit(GROOVES[0]).pads).toHaveLength(16);
  });
});
