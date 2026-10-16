import { describe, expect, test } from "vitest";
import { CHORD_TYPE_NOTES, DEFAULT_KEY, keyName, keyOf, readChord, type Key } from "./chords";

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** "E4 G#4 B4" as MIDI note numbers. */
function midis(notes: string): number[] {
  return notes.split(" ").map((n) => {
    const [, pitch, octave] = n.match(/^([A-G]#?)(-?\d+)$/)!;
    return NAMES.indexOf(pitch) + (Number(octave) + 1) * 12;
  });
}

const read = (notes: string, key: Key = DEFAULT_KEY) => readChord(midis(notes), key);
const named = (notes: string, key?: Key) => {
  const r = read(notes, key);
  return r && [r.name, r.degree];
};

const C_MAJOR = { root: "C", scale: "Major" };

describe("the key", () => {
  test("is E Major until a scale is picked, then the picked one", () => {
    expect(keyOf({ root: "C", scale: "Major", enabled: false })).toEqual({ root: "E", scale: "Major" });
    expect(keyOf({ root: "A", scale: "Natural Minor", enabled: true })).toEqual({ root: "A", scale: "Natural Minor" });
    expect(keyOf({ root: "A", scale: "Bebop", enabled: true })).toEqual(DEFAULT_KEY);
  });

  test("is spelled with the fewest sharps and flats, the root as picked on a tie", () => {
    expect(keyName(DEFAULT_KEY)).toBe("E Major");
    expect(keyName({ root: "A#", scale: "Major" })).toBe("Bb Major");
    expect(keyName({ root: "C#", scale: "Major" })).toBe("Db Major");
    expect(keyName({ root: "D#", scale: "Major" })).toBe("Eb Major");
    expect(keyName({ root: "F#", scale: "Major" })).toBe("F# Major");
    expect(keyName({ root: "C#", scale: "Natural Minor" })).toBe("C# Natural Minor");
    expect(keyName({ root: "A#", scale: "Natural Minor" })).toBe("Bb Natural Minor");
    expect(keyName({ root: "D#", scale: "Natural Minor" })).toBe("D# Natural Minor");
    expect(keyName({ root: "G#", scale: "Minor Pentatonic" })).toBe("G# Minor Pentatonic");
    expect(keyName({ root: "G#", scale: "Major Pentatonic" })).toBe("Ab Major Pentatonic");
  });
});

describe("reading the held notes", () => {
  test("nothing held reads as nothing", () => {
    expect(readChord([], DEFAULT_KEY)).toBeNull();
  });

  test("names the chords of E Major with their degrees", () => {
    expect(read("E4 G#4 B4")).toEqual({ name: "E", quality: "major", notes: ["E", "G#", "B"], degree: "I", inKey: true });
    expect(named("F#4 A4 C#5")).toEqual(["F#m", "ii"]);
    expect(named("G#3 B3 D#4")).toEqual(["G#m", "iii"]);
    expect(named("A3 C#4 E4")).toEqual(["A", "IV"]);
    expect(named("B3 D#4 F#4 A4")).toEqual(["B7", "V7"]);
    expect(named("C#4 E4 G#4 B4")).toEqual(["C#m7", "vi7"]);
    expect(named("D#4 F#4 A4")).toEqual(["D#dim", "vii°"]);
    expect(named("D#4 F#4 A4 C#5")).toEqual(["D#m7b5", "viiø7"]);
    expect(named("E3 G#3 B3 D#4")).toEqual(["Emaj7", "Imaj7"]);
  });

  test("a chord from outside the key says so, with its degree from the key", () => {
    const c = read("C4 E4 G4")!;
    expect(c.name).toBe("C");
    expect(c.degree).toBe("bVI");
    expect(c.inKey).toBe(false);
    expect(named("D4 F#4 A4")).toEqual(["D", "bVII"]);
    expect(named("G3 B3 D4")).toEqual(["G", "bIII"]);
    expect(named("E4 G4 B4")).toEqual(["Em", "i"]);
    expect(named("A#3 C#4 E4")).toEqual(["A#dim", "#iv°"]);
    expect(read("G#4 B4 D#5")!.inKey).toBe(true);
  });

  test("octaves and doubled notes don't change the chord", () => {
    expect(named("E2 B2 E3 G#3 B3 E4")).toEqual(["E", "I"]);
  });

  test("the lowest note decides between chords made of the same notes", () => {
    expect(named("C3 E3 G3 A3", C_MAJOR)).toEqual(["C6", "I6"]);
    expect(named("A2 C3 E3 G3", C_MAJOR)).toEqual(["Am7", "vi7"]);
    expect(named("E3 G3 A3 C4", C_MAJOR)).toEqual(["Am7/E", "vi7"]);
    expect(named("E3 C4 G4", C_MAJOR)).toEqual(["C/E", "I"]);
    expect(named("C3 F3 G3", C_MAJOR)).toEqual(["Csus4", "Isus4"]);
    expect(named("F3 G3 C4", C_MAJOR)).toEqual(["Fsus2", "IVsus2"]);
    expect(named("G#3 B3 D4 F4", C_MAJOR)).toEqual(["G#dim7", "#v°7"]);
    expect(named("B3 D4 F4 G#4", C_MAJOR)).toEqual(["Bdim7", "vii°7"]);
  });

  test("spells chords the way the key does, flats in flat keys", () => {
    const eb = { root: "D#", scale: "Major" };
    expect(read("A#3 D4 F4", eb)).toMatchObject({ name: "Bb", notes: ["Bb", "D", "F"], degree: "V", inKey: true });
    expect(named("G#3 C4 D#4", eb)).toEqual(["Ab", "IV"]);
    expect(named("C4 D#4 G4", eb)).toEqual(["Cm", "vi"]);
    expect(named("A#3 D4 F4", { root: "F", scale: "Major" })).toEqual(["Bb", "IV"]);
    // Borrowed chords in C Major.
    expect(named("A#3 D4 F4", C_MAJOR)).toEqual(["Bb", "bVII"]);
    expect(named("D#4 G4 A#4", C_MAJOR)).toEqual(["Eb", "bIII"]);
    expect(named("G#3 C4 D#4", C_MAJOR)).toEqual(["Ab", "bVI"]);
    expect(read("C#4 F4 G#4", C_MAJOR)).toMatchObject({ name: "Db", notes: ["Db", "F", "Ab"], degree: "bII" });
    expect(named("C#4 E4 G4", C_MAJOR)).toEqual(["C#dim", "#i°"]);
    // The leading tone in a minor key is raised, not a lowered tonic.
    expect(read("E3 G#3 B3", { root: "A", scale: "Natural Minor" })).toMatchObject({ name: "E", notes: ["E", "G#", "B"], degree: "V", inKey: false });
    expect(named("G#3 B3 D4 F4", { root: "A", scale: "Natural Minor" })).toEqual(["G#dim7", "#vii°7"]);
    // A diminished seventh's seventh is a double flat.
    expect(read("C4 D#4 F#4 A4", C_MAJOR)!.notes).toEqual(["C", "Eb", "Gb", "Bbb"]);
  });

  test("names sevenths and more, with or without their fifth", () => {
    expect(named("E3 G#3 D4", DEFAULT_KEY)).toEqual(["E7", "I7"]);
    expect(named("A3 C4 G4", C_MAJOR)).toEqual(["Am7", "vi7"]);
    expect(named("C3 E3 G3 B3 D4", C_MAJOR)).toEqual(["Cmaj9", "Imaj9"]);
    expect(named("D3 F3 A3 C4 E4", C_MAJOR)).toEqual(["Dm9", "ii9"]);
    expect(named("G3 B3 D4 F4 A#4", C_MAJOR)).toEqual(["G7#9", "V7#9"]);
    expect(named("C4 E4 G#4", C_MAJOR)).toEqual(["Caug", "I+"]);
    expect(named("C4 D4 E4 G4", C_MAJOR)).toEqual(["Cadd9", "Iadd9"]);
  });

  test("one note is its name, two make a power chord or an interval", () => {
    expect(read("G#4")).toEqual({ name: "G#", quality: "note", notes: ["G#"], degree: null, inKey: true });
    expect(read("C4")).toMatchObject({ name: "C", inKey: false });
    expect(named("E2 B2")).toEqual(["E5", "I5"]);
    expect(named("B2 E3")).toEqual(["E5/B", "I5"]);
    expect(read("E4 G#4")).toEqual({ name: "E–G#", quality: "major third", notes: ["E", "G#"], degree: null, inKey: true });
    expect(read("C4 C#4", C_MAJOR)).toMatchObject({ name: "C–C#", quality: "minor second" });
  });

  test("notes that make no chord it knows are listed, unnamed", () => {
    expect(read("C4 C#4 D4", C_MAJOR)).toEqual({ name: null, quality: "", notes: ["C", "C#", "D"], degree: null, inKey: false });
  });

  test("every chord type has its own notes, so a chord is never two types", () => {
    expect(new Set(CHORD_TYPE_NOTES).size).toBe(CHORD_TYPE_NOTES.length);
  });

  test("works in every key", () => {
    for (const root of NAMES) {
      for (const scale of ["Major", "Natural Minor", "Dorian", "Phrygian", "Lydian", "Mixolydian", "Locrian", "Major Pentatonic", "Minor Pentatonic", "Chromatic"]) {
        const key = { root, scale };
        expect(keyName(key)).toMatch(/^[A-G][#b]? /);
        const tonic = NAMES.indexOf(root) + 60;
        const r = readChord([tonic, tonic + 7], key)!;
        expect(r.degree).toBe("I5");
        // Locrian's fifth is diminished.
        expect(r.inKey).toBe(scale !== "Locrian");
      }
    }
  });
});
