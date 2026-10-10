// The groove library: drum patterns programmed for Dawn (so they're ours to
// ship), written as step patterns over the Drum Rack's pad layout. Every
// factory kit keeps the same sound on the same pad (kick on C1, snare on
// D1, closed hat on F#1...), so a groove plays right on any kit. Dropped on
// a track, a groove becomes an ordinary MIDI clip at the project's tempo.

import { FACTORY_KITS } from "../instruments/drum-rack/drumKits";
import { padNote } from "../instruments/drum-rack/drumParams";
import { midiToNoteName } from "../instruments/piano/piano";
import type { NoteEvent } from "../project/types";

/** The parts a pattern plays, and the pad each sits on. */
export const GROOVE_ROLES = {
  kick: 0,
  rim: 1,
  snare: 2,
  snap: 3,
  clap: 4,
  tomL: 5,
  ch: 6, // closed hat
  tomM: 7,
  ph: 8, // pedal hat
  tomH: 9,
  oh: 10, // open hat
  cowbell: 11,
  shaker: 12,
  crash: 13,
  clave: 14,
  ride: 15,
} as const;
export type GrooveRole = keyof typeof GROOVE_ROLES;

export const GROOVE_SECTIONS = ["intro", "verse", "chorus", "fill", "ending"] as const;
export type GrooveSection = (typeof GROOVE_SECTIONS)[number];
export const SECTION_LABELS: Record<GrooveSection, string> = { intro: "Intro", verse: "Verse", chorus: "Chorus", fill: "Fill", ending: "Ending" };

export interface GrooveGenre {
  id: string;
  name: string;
  /** A tempo it sounds right at (quarter notes per minute). */
  bpm: number;
  /** The factory kit it was made with: a track without drums gets it. */
  kit: string;
  /** Beats per bar over the beat unit, e.g. [6, 8]. */
  meter: [number, number];
  /** Steps per quarter note: 4 = 16ths, 3 = triplet 8ths, 2 = 8ths, 8 = 32nds. */
  grid: number;
  /** Delays every second 16th by this fraction of a step (0 = straight). */
  swing?: number;
  sections: Partial<Record<GrooveSection, Partial<Record<GrooveRole, string>>>>;
  /** The sound pack it came with. */
  pack?: string;
}

export interface Groove {
  id: string;
  genre: GrooveGenre;
  section: GrooveSection;
  name: string;
  bars: number;
  lanes: Partial<Record<GrooveRole, string>>;
}

/** Velocity for each pattern character; "." and "-" are rests, "|" and spaces just separate bars. */
const VELOCITY: Record<string, number> = { X: 1, x: 0.82, o: 0.6, g: 0.32 };

const r = (s: string, n: number) => Array(n).fill(s).join("|");

const GENRES: GrooveGenre[] = [
  {
    id: "rock",
    name: "Rock",
    bpm: 112,
    kit: "Rock Kit",
    meter: [4, 4],
    grid: 4,
    sections: {
      intro: {
        ch: r("x.x.x.x.x.x.x.x.", 2),
        kick: "x.......x.......|x.......x.x.....",
        snare: "................|....x.......x.xx",
      },
      verse: {
        ch: r("x.x.x.x.x.x.x.x.", 2),
        kick: "x.......x.x.....|x.......x.......",
        snare: r("....x.......x...", 2),
      },
      chorus: {
        crash: "X...............|................",
        ride: "..x.x.x.x.x.x.x.|x.x.x.x.x.x.x.x.",
        kick: "x.....x.x.......|x.....x.x.x.....",
        snare: r("....X.......X...", 2),
      },
      fill: {
        ch: "x.x.x.x.........",
        kick: "x.....x.........",
        snare: "....x...xxxx....",
        tomH: "............xx..",
        tomL: "..............xx",
      },
      ending: { crash: "X...............", kick: "X...............", snare: "X..............." },
    },
  },
  {
    id: "metal",
    name: "Hard Rock / Metal",
    bpm: 150,
    kit: "Rock Kit",
    meter: [4, 4],
    grid: 4,
    sections: {
      intro: {
        crash: "X...X...X...X...|X...............",
        kick: r("x...x...x...x...", 2),
        snare: "................|....x...........",
        tomL: "................|........xxxxxxxx",
      },
      verse: {
        ch: r("x.x.x.x.x.x.x.x.", 2),
        kick: r("oooooooooooooooo", 2),
        snare: r("....X.......X...", 2),
      },
      chorus: {
        crash: "X...x...x...x...|x...x...x...x...",
        kick: r("x.x.x.x.x.x.x.x.", 2),
        snare: r("....X.......X...", 2),
      },
      fill: {
        kick: "x.x.x.x.x.x.x.x.",
        snare: "XxXxXxXx........",
        tomH: "........xx......",
        tomM: "..........xx....",
        tomL: "............xxxx",
      },
      ending: { crash: "X...............", kick: "X...............", snare: "X..............." },
    },
  },
  {
    id: "punk",
    name: "Punk",
    bpm: 180,
    kit: "Rock Kit",
    meter: [4, 4],
    grid: 4,
    sections: {
      intro: {
        snare: "o.o.o.o.x.x.x.x.|xxxxxxxxXXXXXXXX",
        kick: "x.......x.......|x...x...x...x...",
      },
      verse: {
        ch: r("x.x.x.x.x.x.x.x.", 2),
        kick: "x.......x.......|x.......x.x.....",
        snare: r("....x.......x...", 2),
      },
      chorus: {
        crash: "X...............|................",
        oh: "..x.x.x.x.x.x.x.|x.x.x.x.x.x.x.x.",
        kick: r("x...x...x...x...", 2),
        snare: r("..x...x...x...x.", 2),
      },
      fill: { kick: "x.......x.......", snare: "x.x.x.x.xxxxXXXX" },
      ending: { crash: "X...............", kick: "X...............", snare: "X..............." },
    },
  },
  {
    id: "pop",
    name: "Pop",
    bpm: 100,
    kit: "Studio",
    meter: [4, 4],
    grid: 4,
    sections: {
      intro: {
        ch: r("x.x.x.x.x.x.x.x.", 2),
        kick: "x...............|x.......x.......",
        snare: "................|....x.......x.x.",
      },
      verse: {
        ch: r("X.x.X.x.X.x.X.x.", 2),
        kick: "x.....x.x.......|x.....x.x..x....",
        snare: r("....x.......x...", 2),
      },
      chorus: {
        crash: "X...............|................",
        ch: "....x...x...x...|x...x...x...x...",
        oh: r("..x...x...x...x.", 2),
        kick: r("x...x...x...x...", 2),
        snare: r("....x.......x...", 2),
        clap: r("....x.......x...", 2),
      },
      fill: { ch: "x.x.x.x.........", kick: "x.......x.......", snare: "....x...x.x.xxxx" },
      ending: { crash: "X...............", kick: "X...............", clap: "X..............." },
    },
  },
  {
    id: "funk",
    name: "Funk",
    bpm: 100,
    kit: "Studio",
    meter: [4, 4],
    grid: 4,
    sections: {
      intro: {
        ch: r("XoooXoooXoooXooo", 2),
        kick: "x...............|x.....x.........",
        snare: "...g...g...g...g|....X..g.g..XxXx",
      },
      verse: {
        ch: r("XoooXoooXoooXooo", 2),
        kick: "x..x..x...x.....|x.....x...x..x..",
        snare: "....X..g.g..X..g|.g..X..g.g..X.g.",
      },
      chorus: {
        crash: "X...............|................",
        ch: ".oooXoooXoooXo.o|XoooXoooXoooXo.o",
        oh: r("..............x.", 2),
        kick: "x..x..x...x.....|x.....x...x..x..",
        snare: "....X..g.g..X..g|.g..X..g.g..X.g.",
      },
      fill: {
        kick: "x.....x.........",
        snare: "X..g.g..XxXx....",
        tomH: "............xx..",
        tomL: "..............xx",
      },
      ending: { crash: "X...............", kick: "X...............", snare: "X..............." },
    },
  },
  {
    id: "blues",
    name: "Blues Shuffle",
    bpm: 90,
    kit: "Brushes",
    meter: [4, 4],
    grid: 3,
    sections: {
      intro: {
        ch: r("x.xx.xx.xx.x", 2),
        kick: "x...........|x.....x.....",
        snare: "............|.........xxx",
      },
      verse: {
        ch: r("x.xx.xx.xx.x", 2),
        kick: r("x.....x.....", 2),
        snare: r("...x.....x..", 2),
      },
      chorus: {
        crash: "X...........|............",
        ride: "..xX.xX.xX.x|X.xX.xX.xX.x",
        kick: r("x.....x.....", 2),
        snare: r("...X.....X..", 2),
      },
      fill: {
        kick: "x.....x.....",
        snare: "x..x..xxx...",
        tomM: ".........x..",
        tomL: "..........xx",
      },
      ending: { crash: "X...........", kick: "X...........", snare: "X..........." },
    },
  },
  {
    id: "ballad",
    name: "6/8 Ballad",
    bpm: 90,
    kit: "Brushes",
    meter: [6, 8],
    grid: 2,
    sections: {
      intro: { ch: r("Xooxoo", 2), kick: "x.....|x.....", snare: "......|....xx" },
      verse: { ch: r("Xooxoo", 2), kick: "x.....|x..x..", snare: r("...x..", 2) },
      chorus: { crash: "X.....|......", ride: ".xxxxx|Xxxxxx", kick: "x.....|x..x..", snare: r("...X..", 2) },
      fill: { kick: "x.....", snare: "x.x...", tomM: "....x.", tomL: ".....x" },
      ending: { crash: "X.....", kick: "X....." },
    },
  },
  {
    id: "hiphop",
    name: "Hip-Hop",
    bpm: 90,
    kit: "Dawn 808",
    meter: [4, 4],
    grid: 4,
    swing: 0.12,
    sections: {
      intro: {
        ch: r("x.x.x.x.x.x.x.x.", 2),
        kick: "x...............|x.......x.......",
        snare: "................|............x...",
      },
      verse: {
        ch: "x.x.x.x.x.x.x.x.|x.x.x.x.x.x.x.xx",
        kick: "x......x..x.....|x.x....x..x.....",
        snare: r("....x.......x...", 2),
      },
      chorus: {
        crash: "X...............|................",
        ch: "..x.x.x.x.x.x...|x.x.x.x.x.x.x...",
        oh: r("..............x.", 2),
        kick: "x......x..x.....|x.x....x..x.....",
        snare: r("....x.......x...", 2),
        clap: r("....x.......x...", 2),
      },
      fill: { kick: "x......x..x.....", snare: "....x.......oxXx" },
      ending: { crash: "X...............", kick: "X..............." },
    },
  },
  {
    id: "trap",
    name: "Trap",
    bpm: 140,
    kit: "Trap",
    meter: [4, 4],
    grid: 8,
    sections: {
      intro: {
        ch: r("x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.", 2),
        kick: "x...............................|x...............................",
      },
      verse: {
        ch: "x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.|x.x.x.x.x.x.x.x.x.x.x.x.xxxxxxxx",
        kick: "x.....x...........x.....x.......|x.........x.......x..x..........",
        clap: r("................x...............", 2),
      },
      chorus: {
        crash: "X...............................|................................",
        ch: "..x.x.x.xxxx..x.x.x.x.x.xxxxxxxx|x.x.x.x.xxxx..x.x.x.x.x.xxxxxxxx",
        oh: "............x...................|............x...................",
        kick: "x.....x...x.......x.....x...x...|x.........x.......x..x..x.......",
        clap: r("................x...............", 2),
        snare: r("................x...............", 2),
      },
      fill: {
        ch: "x.x.x.x.x.x.x.x.xxxxxxxxxxxxxxxx",
        kick: "x.....x...........x.............",
        snare: "................x...x.x.xxxxxxxx",
      },
      ending: { crash: "X...............................", kick: "X..............................." },
    },
  },
  {
    id: "reggaeton",
    name: "Reggaeton",
    bpm: 95,
    kit: "Dawn 808",
    meter: [4, 4],
    grid: 4,
    sections: {
      intro: {
        kick: r("x...x...x...x...", 2),
        shaker: r("xoxoxoxoxoxoxoxo", 2),
        snare: "................|...x..x....x..x.",
      },
      verse: {
        ch: r("x.x.x.x.x.x.x.x.", 2),
        kick: r("x...x...x...x...", 2),
        snare: r("...x..x....x..x.", 2),
      },
      chorus: {
        crash: "X...............|................",
        shaker: r("xoxoxoxoxoxoxoxo", 2),
        kick: r("x...x...x...x...", 2),
        snare: r("...x..x....x..x.", 2),
        clap: r("...x..x....x..x.", 2),
      },
      fill: { kick: "x...x...x...x...", snare: "...x..x.x.x.xxxx", tomL: "..............x." },
      ending: { crash: "X...............", kick: "X..............." },
    },
  },
  {
    id: "lofi",
    name: "Lo-Fi",
    bpm: 80,
    kit: "Lo-Fi",
    meter: [4, 4],
    grid: 4,
    swing: 0.18,
    sections: {
      intro: {
        ch: r("x.o.x.o.x.o.x.o.", 2),
        kick: "x...............|x......x........",
      },
      verse: {
        ch: "x.o.x.o.x.o.x.o.|x.o.x.o.x.o.x.oo",
        kick: "x......x..x.....|x.x....x........",
        snare: r("....o.......o...", 2),
      },
      chorus: {
        ch: r("x.o.x.o.x.o.x...", 2),
        oh: r("..............o.", 2),
        shaker: r("..o...o...o...o.", 2),
        kick: "x......x..x.....|x.x....x........",
        snare: r("....o.......o...", 2),
        clap: r("....o.......o...", 2),
      },
      fill: { kick: "x......x........", snare: "....o......g.ogo" },
      ending: { kick: "X...............", oh: "X..............." },
    },
  },
  {
    id: "house",
    name: "House",
    bpm: 124,
    kit: "909 Punch",
    meter: [4, 4],
    grid: 4,
    sections: {
      intro: {
        kick: r("x...x...x...x...", 2),
        ch: r("oo.ooo.ooo.ooo.o", 2),
      },
      verse: {
        kick: r("x...x...x...x...", 2),
        clap: r("....x.......x...", 2),
        ch: r("oo.ooo.ooo.ooo.o", 2),
        oh: r("..x...x...x...x.", 2),
      },
      chorus: {
        crash: "X...............|................",
        kick: r("x...x...x...x...", 2),
        clap: r("....x.......x...", 2),
        ch: r("oo.ooo.ooo.ooo.o", 2),
        oh: r("..x...x...x...x.", 2),
        shaker: r("oxoxoxoxoxoxoxox", 2),
      },
      fill: { kick: "x...x...x...x...", clap: "....x.......x...", snare: "........oooxxxXX" },
      ending: { crash: "X...............", kick: "X..............." },
    },
  },
];

export const GROOVE_GENRES = GENRES;

/** Steps in one bar of a genre's patterns. */
export function stepsPerBar(g: GrooveGenre): number {
  return ((g.meter[0] * 4) / g.meter[1]) * g.grid;
}

/** Quarter notes in one bar. */
export function beatsPerBarOf(g: GrooveGenre): number {
  return (g.meter[0] * 4) / g.meter[1];
}

const steps = (lane: string) => lane.replace(/[|\s]/g, "");

function barsOf(genre: GrooveGenre, lanes: Partial<Record<GrooveRole, string>>): number {
  const longest = Math.max(...Object.values(lanes).map((l) => steps(l ?? "").length));
  return Math.max(1, Math.round(longest / stepsPerBar(genre)));
}

function groovesOf(genres: GrooveGenre[]): Groove[] {
  return genres.flatMap((genre) =>
    GROOVE_SECTIONS.filter((section) => genre.sections[section]).map((section) => {
      const lanes = genre.sections[section]!;
      return {
        id: `${genre.id}-${section}`,
        genre,
        section,
        name: `${genre.name} ${SECTION_LABELS[section]}`,
        bars: barsOf(genre, lanes),
        lanes,
      };
    })
  );
}

/** The built-in grooves. */
export const GROOVES: Groove[] = groovesOf(GENRES);

// --- grooves from sound packs ---

let packGenres: GrooveGenre[] = [];
let allGenresCache: GrooveGenre[] | null = null;
let allGroovesCache: Groove[] | null = null;
const listeners = new Set<() => void>();

function changedPacks(next: GrooveGenre[]) {
  packGenres = next;
  allGenresCache = null;
  allGroovesCache = null;
  listeners.forEach((l) => l());
}

/** Built-in genres, then ones from packs (a stable array until a pack changes). */
export function allGrooveGenres(): GrooveGenre[] {
  allGenresCache ??= [...GENRES, ...packGenres];
  return allGenresCache;
}

export function allGrooves(): Groove[] {
  allGroovesCache ??= [...GROOVES, ...groovesOf(packGenres)];
  return allGroovesCache;
}

export function subscribeGrooves(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setPackGrooves(packId: string, genres: GrooveGenre[]): void {
  changedPacks([...packGenres.filter((g) => g.pack !== packId), ...genres]);
}

export function removePackGrooves(packId: string): void {
  if (packGenres.some((g) => g.pack === packId)) changedPacks(packGenres.filter((g) => g.pack !== packId));
}

const ROLE_NAMES = Object.keys(GROOVE_ROLES) as GrooveRole[];

/** A pack's grooves, written like the built-in ones (see GENRES above),
 * checked strictly: anything malformed is left out. */
export function parsePackGrooves(raw: unknown, packId: string): GrooveGenre[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, i): GrooveGenre[] => {
    const r = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 40) : "";
    const meter = Array.isArray(r.meter) && r.meter.length === 2 ? (r.meter as unknown[]) : [4, 4];
    const [beats, unit] = meter.map(Number);
    const grid = Number(r.grid ?? 4);
    const bpm = Number(r.bpm ?? 120);
    const swing = r.swing === undefined ? 0 : Number(r.swing);
    if (!name || !(beats >= 1 && beats <= 16 && Number.isInteger(beats)) || ![2, 4, 8, 16].includes(unit)) return [];
    if (![2, 3, 4, 6, 8].includes(grid) || !(bpm >= 40 && bpm <= 240) || !(swing >= 0 && swing <= 0.5)) return [];
    const genre: GrooveGenre = {
      id: `pack-${packId}-${i}`,
      name,
      bpm: Math.round(bpm),
      kit: typeof r.kit === "string" && FACTORY_KITS.some((k) => k.name === r.kit) ? r.kit : "Dawn 808",
      meter: [beats, unit],
      grid,
      ...(swing ? { swing } : {}),
      sections: {},
      pack: packId,
    };
    const per = stepsPerBar(genre);
    const sections = r.sections && typeof r.sections === "object" ? (r.sections as Record<string, unknown>) : {};
    for (const section of GROOVE_SECTIONS) {
      const lanesRaw = sections[section];
      if (!lanesRaw || typeof lanesRaw !== "object") continue;
      const lanes: Partial<Record<GrooveRole, string>> = {};
      let length = -1;
      let ok = true;
      for (const [role, lane] of Object.entries(lanesRaw as Record<string, unknown>)) {
        if (!ROLE_NAMES.includes(role as GrooveRole) || typeof lane !== "string" || lane.length > 4096 || !/^[.\-xXog|\s]*$/.test(lane)) {
          ok = false;
          break;
        }
        const n = steps(lane).length;
        if (n === 0 || n % per !== 0 || n / per > 16 || (length >= 0 && n !== length)) {
          ok = false;
          break;
        }
        length = n;
        lanes[role as GrooveRole] = lane;
      }
      if (ok && length > 0) genre.sections[section] = lanes;
    }
    return Object.keys(genre.sections).length ? [genre] : [];
  });
}

export function grooveById(id: string): Groove | undefined {
  return allGrooves().find((g) => g.id === id);
}

/** Quarter notes the groove lasts. */
export function grooveBeats(g: Groove): number {
  return g.bars * beatsPerBarOf(g.genre);
}

export interface GrooveHit {
  pad: number;
  /** Quarter notes from the start. */
  beat: number;
  velocity: number;
}

/** Every hit in the groove, in time order, with swing applied. */
export function grooveHits(g: Groove): GrooveHit[] {
  const stepBeats = 1 / g.genre.grid;
  const swing = g.genre.grid === 4 ? (g.genre.swing ?? 0) : 0;
  const hits: GrooveHit[] = [];
  (Object.keys(g.lanes) as GrooveRole[]).forEach((role) => {
    const pattern = steps(g.lanes[role] ?? "");
    for (let i = 0; i < pattern.length; i++) {
      const velocity = VELOCITY[pattern[i]];
      if (!velocity) continue;
      const swung = i % 2 === 1 ? swing * stepBeats : 0;
      hits.push({ pad: GROOVE_ROLES[role], beat: i * stepBeats + swung, velocity });
    }
  });
  return hits.sort((a, b) => a.beat - b.beat || a.pad - b.pad);
}

/** The groove as clip notes (seconds) at a tempo. */
export function grooveNotes(g: Groove, bpm: number): NoteEvent[] {
  const spb = 60 / bpm;
  const length = Math.min(0.25, 1 / g.genre.grid) * spb;
  return grooveHits(g).map((h) => ({
    note: midiToNoteName(padNote(h.pad)),
    time: h.beat * spb,
    duration: length * 0.9,
    velocity: h.velocity,
  }));
}

/** The factory kit a genre was made with (or the default one). */
export function grooveKit(g: Groove) {
  return (FACTORY_KITS.find((k) => k.name === g.genre.kit) ?? FACTORY_KITS[0]).kit;
}

/** The MIME type a groove travels under when dragged onto a track. */
export const GROOVE_DRAG_MIME = "application/x-dawn-groove";
