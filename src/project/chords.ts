// Naming the chord being played, for the readout on the on-screen piano,
// in a key: spelled the way the key spells its notes (G# in E Major, Ab in
// Eb Major), with its degree in the key as a Roman numeral (V7, iii, bVII)
// and whether all of its notes are in the key's scale. With no scale
// picked, chords are named in E Major. Pure.

import { SCALE_ROOTS, SCALES, isNoteInScale, type ScaleSetting } from "./scales";

export interface Key {
  root: string;
  scale: string;
}

/** The key chords are named in while no scale is picked. */
export const DEFAULT_KEY: Key = { root: "E", scale: "Major" };

/** The key chords are named in with this scale setting. */
export function keyOf(setting: ScaleSetting): Key {
  const known = SCALES[setting.scale] && (SCALE_ROOTS as readonly string[]).includes(setting.root);
  return setting.enabled && known ? { root: setting.root, scale: setting.scale } : DEFAULT_KEY;
}

// --- Spelling ---

/** A note's name: a letter (0..6, C to B), raised or lowered (sharps are
 * positive). */
interface Spelled {
  letter: number;
  alter: number;
}

const LETTERS = "CDEFGAB";
const LETTER_PITCH = [0, 2, 4, 5, 7, 9, 11];
/** Where each letter is on the line of fifths (C at 0, G at 1, F at -1). */
const LETTER_FIFTHS = [0, 2, 4, -1, 1, 3, 5];

const mod = (n: number, m: number) => ((n % m) + m) % m;
const pitchOf = (s: Spelled) => mod(LETTER_PITCH[s.letter] + s.alter, 12);
const fifthsOf = (s: Spelled) => LETTER_FIFTHS[s.letter] + 7 * s.alter;
const accidental = (alter: number) => (alter > 0 ? "#".repeat(alter) : "b".repeat(-alter));
const nameOf = (s: Spelled) => LETTERS[s.letter] + accidental(s.alter);

/** How far `letter`'s note is raised or lowered to make pitch class `pc`. */
function alterFor(pc: number, letter: number): number {
  const d = mod(pc - LETTER_PITCH[letter], 12);
  return d > 6 ? d - 12 : d;
}

/** The seven-note scale a key with fewer or more notes is spelled by. */
const SPELLED_BY: Record<string, string> = {
  "Major Pentatonic": "Major",
  "Minor Pentatonic": "Natural Minor",
  Chromatic: "Major",
};

/** How a key spells its notes: its tonic and its seven degrees, and the
 * middle of them on the line of fifths (for notes outside it). */
interface KeySpelling {
  tonic: Spelled;
  degrees: Spelled[];
  center: number;
}

function spellKey(key: Key): KeySpelling {
  const tonic = SCALE_ROOTS.indexOf(key.root as (typeof SCALE_ROOTS)[number]);
  const own = SCALES[key.scale];
  const steps = own?.length === 7 ? own : SCALES[SPELLED_BY[key.scale] ?? "Major"];
  let best: KeySpelling | null = null;
  let fewest = Infinity;
  // Each way to spell the tonic (C# or Db): the one with the fewest sharps
  // and flats wins (C# Major is spelled Db Major), the root as picked on a
  // tie (F# Major, not Gb).
  for (let letter = 0; letter < 7; letter++) {
    const alter = alterFor(tonic, letter);
    if (Math.abs(alter) > 1) continue;
    const degrees = steps.map((step, i) => {
      const l = (letter + i) % 7;
      return { letter: l, alter: alterFor(tonic + step, l) };
    });
    const count = degrees.reduce((sum, d) => sum + (Math.abs(d.alter) > 1 ? 10 : Math.abs(d.alter)), 0);
    const better = count < fewest || (count === fewest && alter === 0);
    if (!best || better) {
      fewest = count;
      best = { tonic: { letter, alter }, degrees, center: degrees.reduce((sum, d) => sum + fifthsOf(d), 0) / 7 };
    }
  }
  return best!;
}

/** Pitch class `pc` as the key spells it: its own notes as they are; a note
 * outside it with the fewest sharps or flats, then the one closest to the
 * key on the line of fifths (Bb in C Major, A# in E Major), then the one
 * closer to the tonic (Ab in C Major, G# in A Minor). */
function spellPitch(pc: number, key: KeySpelling): Spelled {
  const own = key.degrees.find((d) => pitchOf(d) === pc);
  if (own) return own;
  const tonic = fifthsOf(key.tonic);
  let best: Spelled | null = null;
  let bestCost: number[] = [];
  for (let letter = 0; letter < 7; letter++) {
    const alter = alterFor(pc, letter);
    if (Math.abs(alter) > 1) continue;
    const s = { letter, alter };
    const cost = [Math.abs(alter), Math.abs(fifthsOf(s) - key.center), Math.abs(fifthsOf(s) - tonic)];
    const i = cost.findIndex((c, j) => c !== bestCost[j]);
    if (!best || (i >= 0 && cost[i] < bestCost[i])) {
      best = s;
      bestCost = cost;
    }
  }
  return best!;
}

/** The notes of a chord on `root` (tones: semitones and letters above it). */
function spellChord(root: Spelled, tones: readonly [number, number][]): Spelled[] {
  const pc = pitchOf(root);
  return tones.map(([semi, letters]) => {
    const letter = (root.letter + letters) % 7;
    return { letter, alter: alterFor(pc + semi, letter) };
  });
}

/** A chord's root as the key spells it; one outside the key the way that
 * gives the chord the fewest sharps and flats (Db F Ab rather than C# E#
 * G#), then as spellPitch would. */
function spellRoot(pc: number, tones: readonly [number, number][], key: KeySpelling): Spelled {
  const own = key.degrees.find((d) => pitchOf(d) === pc);
  if (own) return own;
  const usual = spellPitch(pc, key);
  const count = (root: Spelled) => spellChord(root, tones).reduce((sum, t) => sum + Math.abs(t.alter), 0);
  let best = usual;
  let fewest = count(usual);
  for (let letter = 0; letter < 7; letter++) {
    const alter = alterFor(pc, letter);
    if (Math.abs(alter) > 1) continue;
    const n = count({ letter, alter });
    if (n < fewest) {
      best = { letter, alter };
      fewest = n;
    }
  }
  return best;
}

/** The key's name, spelled: "E Major", "Bb Major", "F# Natural Minor". */
export function keyName(key: Key): string {
  return `${nameOf(spellKey(key).tonic)} ${key.scale}`;
}

// --- Chords ---

/** A chord tone: semitones and letters above the root (a 3rd is two
 * letters up, a 9th one). */
const TONES: Record<string, [number, number]> = {
  "1": [0, 0],
  b9: [1, 1],
  "2": [2, 1],
  "9": [2, 1],
  "#9": [3, 1],
  b3: [3, 2],
  "3": [4, 2],
  "4": [5, 3],
  "11": [5, 3],
  b5: [6, 4],
  "5": [7, 4],
  "#5": [8, 4],
  "6": [9, 5],
  "13": [9, 5],
  bb7: [9, 6],
  b7: [10, 6],
  "7": [11, 6],
};

interface ChordType {
  /** After the root's name: "m7" makes "Am7". */
  symbol: string;
  tones: string;
  quality: string;
  /** Written with a lowercase numeral (ii, vii°). */
  minor?: boolean;
  /** After the numeral: "7" makes "V7". */
  numeral: string;
}

/** The chords this knows, the commoner first: when notes make more than
 * one (C6 is Am7), the one on the lowest note wins, then the earlier. */
const CHORD_TYPES: ChordType[] = [
  { symbol: "", tones: "1 3 5", quality: "major", numeral: "" },
  { symbol: "m", tones: "1 b3 5", quality: "minor", minor: true, numeral: "" },
  { symbol: "7", tones: "1 3 5 b7", quality: "dominant seventh", numeral: "7" },
  { symbol: "maj7", tones: "1 3 5 7", quality: "major seventh", numeral: "maj7" },
  { symbol: "m7", tones: "1 b3 5 b7", quality: "minor seventh", minor: true, numeral: "7" },
  { symbol: "dim", tones: "1 b3 b5", quality: "diminished", minor: true, numeral: "°" },
  { symbol: "m7b5", tones: "1 b3 b5 b7", quality: "half-diminished seventh", minor: true, numeral: "ø7" },
  { symbol: "dim7", tones: "1 b3 b5 bb7", quality: "diminished seventh", minor: true, numeral: "°7" },
  { symbol: "sus4", tones: "1 4 5", quality: "suspended fourth", numeral: "sus4" },
  { symbol: "sus2", tones: "1 2 5", quality: "suspended second", numeral: "sus2" },
  { symbol: "aug", tones: "1 3 #5", quality: "augmented", numeral: "+" },
  { symbol: "6", tones: "1 3 5 6", quality: "major sixth", numeral: "6" },
  { symbol: "m6", tones: "1 b3 5 6", quality: "minor sixth", minor: true, numeral: "6" },
  { symbol: "7sus4", tones: "1 4 5 b7", quality: "seventh, suspended fourth", numeral: "7sus4" },
  { symbol: "mMaj7", tones: "1 b3 5 7", quality: "minor major seventh", minor: true, numeral: "maj7" },
  { symbol: "add9", tones: "1 3 5 9", quality: "added ninth", numeral: "add9" },
  { symbol: "madd9", tones: "1 b3 5 9", quality: "minor, added ninth", minor: true, numeral: "add9" },
  { symbol: "9", tones: "1 3 5 b7 9", quality: "dominant ninth", numeral: "9" },
  { symbol: "maj9", tones: "1 3 5 7 9", quality: "major ninth", numeral: "maj9" },
  { symbol: "m9", tones: "1 b3 5 b7 9", quality: "minor ninth", minor: true, numeral: "9" },
  { symbol: "6/9", tones: "1 3 5 6 9", quality: "six-nine", numeral: "6/9" },
  { symbol: "7#5", tones: "1 3 #5 b7", quality: "augmented seventh", numeral: "+7" },
  { symbol: "7b5", tones: "1 3 b5 b7", quality: "seventh, flat fifth", numeral: "7b5" },
  { symbol: "7b9", tones: "1 3 5 b7 b9", quality: "seventh, flat ninth", numeral: "7b9" },
  { symbol: "7#9", tones: "1 3 5 b7 #9", quality: "seventh, sharp ninth", numeral: "7#9" },
  { symbol: "m11", tones: "1 b3 5 b7 9 11", quality: "minor eleventh", minor: true, numeral: "11" },
  { symbol: "13", tones: "1 3 5 b7 9 13", quality: "dominant thirteenth", numeral: "13" },
  // Without the fifth, the way they're often played.
  { symbol: "7", tones: "1 3 b7", quality: "dominant seventh", numeral: "7" },
  { symbol: "maj7", tones: "1 3 7", quality: "major seventh", numeral: "maj7" },
  { symbol: "m7", tones: "1 b3 b7", quality: "minor seventh", minor: true, numeral: "7" },
  { symbol: "9", tones: "1 3 b7 9", quality: "dominant ninth", numeral: "9" },
  { symbol: "maj9", tones: "1 3 7 9", quality: "major ninth", numeral: "maj9" },
  { symbol: "m9", tones: "1 b3 b7 9", quality: "minor ninth", minor: true, numeral: "9" },
  { symbol: "5", tones: "1 5", quality: "power chord", numeral: "5" },
];

const TYPE_TONES = CHORD_TYPES.map((t) => t.tones.split(" ").map((n) => TONES[n]));
const setKey = (semitones: number[]) => [...semitones].sort((a, b) => a - b).join(",");
/** Each chord type, by its notes above the root ("0,4,7"). */
const BY_NOTES = new Map<string, number>();
TYPE_TONES.forEach((tones, i) => {
  const k = setKey(tones.map(([semi]) => semi));
  if (!BY_NOTES.has(k)) BY_NOTES.set(k, i);
});

/** For tests: every chord type's notes above its root. */
export const CHORD_TYPE_NOTES = TYPE_TONES.map((tones) => setKey(tones.map(([semi]) => semi)));

const INTERVALS = [
  "unison",
  "minor second",
  "major second",
  "minor third",
  "major third",
  "perfect fourth",
  "tritone",
  "perfect fifth",
  "minor sixth",
  "major sixth",
  "minor seventh",
  "major seventh",
];

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

export interface ChordReading {
  /** The chord's symbol (G#m7, C/E, E5), a note's name (G#), two notes'
   * names (E–G#), or null for notes that make no chord this knows. */
  name: string | null;
  /** What it is, in words: "minor seventh", "major third", "note". */
  quality: string;
  /** The notes, spelled in the key: a chord's from its root, otherwise
   * from the lowest up. */
  notes: string[];
  /** A chord's degree in the key (V7, iii, bVII), as a Roman numeral. */
  degree: string | null;
  /** All of the notes are in the key's scale. */
  inKey: boolean;
}

/** What the held notes (MIDI note numbers) are in `key`; null for none. */
export function readChord(midis: Iterable<number>, key: Key): ChordReading | null {
  const sorted = [...new Set(midis)].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const spelling = spellKey(key);
  // Each pitch once, from the lowest note up.
  const pitches = [...new Set(sorted.map((m) => mod(m, 12)))];
  const bass = pitches[0];
  const scale = { root: key.root, scale: key.scale, enabled: true };
  const inKey = pitches.every((pc) => isNoteInScale(pc, scale));
  const spelled = pitches.map((pc) => nameOf(spellPitch(pc, spelling)));

  if (pitches.length === 1) return { name: spelled[0], quality: "note", notes: spelled, degree: null, inKey };

  // The chord on the lowest note; or else, on another one (a slash chord),
  // the commonest.
  let match: { root: number; type: number } | null = null;
  for (const root of pitches) {
    const type = BY_NOTES.get(setKey(pitches.map((pc) => mod(pc - root, 12))));
    if (type === undefined) continue;
    if (root === bass) {
      match = { root, type };
      break;
    }
    if (!match || type < match.type) match = { root, type };
  }

  if (!match) {
    if (pitches.length > 2) return { name: null, quality: "", notes: spelled, degree: null, inKey };
    const interval = INTERVALS[mod(pitches[1] - bass, 12)];
    return { name: `${spelled[0]}–${spelled[1]}`, quality: interval, notes: spelled, degree: null, inKey };
  }

  const type = CHORD_TYPES[match.type];
  const root = spellRoot(match.root, TYPE_TONES[match.type], spelling);
  const tones = spellChord(root, TYPE_TONES[match.type]);
  const bassTone = tones.find((t) => pitchOf(t) === bass)!;
  const name = nameOf(root) + type.symbol + (match.root === bass ? "" : `/${nameOf(bassTone)}`);
  // The degree its root is on, from its letter (a Bb in C Major is on the
  // seventh, lowered).
  const step = mod(root.letter - spelling.tonic.letter, 7);
  const roman = type.minor ? ROMAN[step].toLowerCase() : ROMAN[step];
  const degree = accidental(root.alter - spelling.degrees[step].alter) + roman + type.numeral;
  return { name, quality: type.quality, notes: tones.map(nameOf), degree, inKey };
}
