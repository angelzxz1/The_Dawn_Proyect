import { describe, expect, it } from "vitest";
import {
  HISTORY_FILE,
  PROJECT_FILE,
  SAMPLES_DIR,
  decodeBundle,
  deserializeClips,
  deserializeTakes,
  encodeBundle,
  fileNameFor,
  loadFromFolder,
  normalizeSnapshot,
  referencedClipIds,
  safeName,
  saveToFolder,
  serializeClips,
  serializeTakes,
  type ProjectDocument,
  type ProjectFolder,
} from "./projectFiles";
import { normalizeProject, type SerializedProject } from "./projectSchema";
import type { ClipInstance, TakeLane } from "./types";

/** An in-memory folder with the File System Access API's shape. */
class FakeDir {
  kind = "directory" as const;
  files = new Map<string, Blob>();
  dirs = new Map<string, FakeDir>();
  writes = 0;
  constructor(public name: string) {}
  async getDirectoryHandle(name: string, o?: { create?: boolean }) {
    if (!this.dirs.has(name)) {
      if (!o?.create) throw new Error("NotFound");
      this.dirs.set(name, new FakeDir(name));
    }
    return this.dirs.get(name)!;
  }
  async getFileHandle(name: string, o?: { create?: boolean }) {
    if (!this.files.has(name) && !o?.create) throw new Error("NotFound");
    return {
      kind: "file" as const,
      getFile: async () => new File([this.files.get(name)!], name, { type: this.files.get(name)!.type }),
      createWritable: async () => {
        const parts: (Blob | string)[] = [];
        return {
          write: async (d: Blob | string) => void parts.push(d),
          close: async () => {
            this.writes++;
            this.files.set(name, new Blob(parts, { type: parts[0] instanceof Blob ? parts[0].type : "" }));
          },
        };
      },
    };
  }
  async removeEntry(name: string) {
    this.files.delete(name);
    this.dirs.delete(name);
  }
  async *keys() {
    yield* this.files.keys();
    yield* this.dirs.keys();
  }
}

function project(clips: SerializedProject["clipsByChannel"] = {}): SerializedProject {
  const base = normalizeProject({})!;
  return normalizeProject({ ...base, channels: [{ id: "ch-1", name: "Guitar", type: "audio" }], clipsByChannel: clips, bpm: 97 })!;
}
const audioClip = (id: string) => ({ id, kind: "audio" as const, offset: 0, length: 1, fileName: "take.wav", durationSeconds: 1, peaks: [], sourceOffset: 0, fadeIn: 0, fadeOut: 0, gainDb: 0 });
const wav = (bytes: number[]) => new Blob([new Uint8Array(bytes)], { type: "audio/wav" });
const bytes = async (b: Blob) => Array.from(new Uint8Array(await b.arrayBuffer()));

function doc(): ProjectDocument {
  const p = project({ "ch-1": [audioClip("clip-2")] });
  const older = { ...p, bpm: 90, clipsByChannel: { "ch-1": [audioClip("clip-1")] } };
  return {
    name: "My Song",
    project: p,
    history: { past: [older], future: [] },
    blobs: new Map([
      ["clip-1", wav([1, 2, 3])],
      ["clip-2", wav([4, 5, 6, 7])],
    ]),
  };
}

describe("project folders", () => {
  it("save and open a project, its samples and its history", async () => {
    const dir = new FakeDir("My Song");
    await saveToFolder(dir as unknown as ProjectFolder, doc());
    expect([...dir.files.keys()].sort()).toEqual([HISTORY_FILE, PROJECT_FILE].sort());
    expect([...dir.dirs.get(SAMPLES_DIR)!.files.keys()].sort()).toEqual(["clip-1.wav", "clip-2.wav"]);

    const opened = await loadFromFolder(dir as unknown as ProjectFolder);
    expect(opened.name).toBe("My Song");
    expect(opened.project.bpm).toBe(97);
    expect(opened.project.channels[0].name).toBe("Guitar");
    expect(await bytes(opened.blobs.get("clip-2")!)).toEqual([4, 5, 6, 7]);
    expect(opened.blobs.get("clip-2")!.type).toBe("audio/wav");
    // Undo history comes back, and still reaches the older take.
    expect(opened.history!.past).toHaveLength(1);
    expect(opened.history!.past[0].bpm).toBe(90);
    expect(await bytes(opened.blobs.get("clip-1")!)).toEqual([1, 2, 3]);
  });

  it("only writes new samples, and drops ones nothing uses", async () => {
    const dir = new FakeDir("My Song");
    const d = doc();
    await saveToFolder(dir as unknown as ProjectFolder, d);
    const samples = dir.dirs.get(SAMPLES_DIR)!;
    const writesBefore = samples.writes;
    // Save again with the history gone (so clip-1 isn't needed) and a new take.
    d.history = null;
    d.blobs.delete("clip-1");
    d.blobs.set("clip-3", wav([9]));
    await saveToFolder(dir as unknown as ProjectFolder, d);
    expect(samples.writes - writesBefore).toBe(1);
    expect([...samples.files.keys()].sort()).toEqual(["clip-2.wav", "clip-3.wav"]);
  });

  it("opens a project whose history is missing or damaged", async () => {
    const dir = new FakeDir("My Song");
    await saveToFolder(dir as unknown as ProjectFolder, doc());
    dir.files.set(HISTORY_FILE, new Blob(["{not json"]));
    const opened = await loadFromFolder(dir as unknown as ProjectFolder);
    expect(opened.history).toBeNull();
    expect(opened.project.bpm).toBe(97);
  });
});

describe("project files (one file)", () => {
  it("round-trips the project, history and every file", async () => {
    const opened = await decodeBundle(await encodeBundle(doc()));
    expect(opened.name).toBe("My Song");
    expect(opened.project.bpm).toBe(97);
    expect(opened.history!.past[0].bpm).toBe(90);
    expect(await bytes(opened.blobs.get("clip-1")!)).toEqual([1, 2, 3]);
    expect(await bytes(opened.blobs.get("clip-2")!)).toEqual([4, 5, 6, 7]);
    expect(opened.blobs.get("clip-2")!.type).toBe("audio/wav");
  });

  it("keeps a file that several clips play once, and gives it back to each", async () => {
    const shared = wav([9, 9, 9, 9, 9]);
    const p = project({ "ch-1": [audioClip("clip-1"), audioClip("clip-2")] });
    const withTakes = normalizeProject({ ...p, takesByChannel: { "ch-1": [{ id: "take-1", name: "Take 1", clips: [audioClip("clip-3")] }] } })!;
    const blobs = new Map([
      ["clip-1", shared],
      ["clip-2", shared],
      ["clip-3", shared],
    ]);
    const bundle = await encodeBundle({ name: "Takes", project: withTakes, history: null, blobs });
    // The five bytes are in it once: after the magic, the header's length
    // and the header, there are just five.
    const headerLength = new DataView(await bundle.slice(8, 12).arrayBuffer()).getUint32(0, true);
    expect(bundle.size - 12 - headerLength).toBe(5);
    const opened = await decodeBundle(bundle);
    expect(opened.project.takesByChannel["ch-1"][0].clips[0].id).toBe("clip-3");
    expect(opened.blobs.get("clip-1")).toBe(opened.blobs.get("clip-3"));
    expect(await bytes(opened.blobs.get("clip-2")!)).toEqual([9, 9, 9, 9, 9]);

    const dir = new FakeDir("Takes");
    await saveToFolder(dir as unknown as ProjectFolder, { name: "Takes", project: withTakes, history: null, blobs });
    expect([...(await dir.getDirectoryHandle(SAMPLES_DIR)).files.keys()]).toEqual(["clip-1.wav"]);
    const fromFolder = await loadFromFolder(dir as unknown as ProjectFolder);
    expect(fromFolder.blobs.get("clip-3")).toBe(fromFolder.blobs.get("clip-1"));
  });

  it("refuses anything else", async () => {
    await expect(decodeBundle(new Blob(["hello world, not a project"]))).rejects.toThrow(/isn't a project file/);
  });
});

describe("helpers", () => {
  it("repairs damaged undo steps like projects", () => {
    const base = project();
    const s = normalizeSnapshot({ bpm: "fast", channels: [{ id: "ch-9", name: 5 }] }, base)!;
    expect(s.bpm).toBe(120); // an unreadable tempo falls back to the default
    expect(s.channels[0].id).toBe("ch-9");
    expect(normalizeSnapshot("nope", base)).toBeNull();
  });

  it("names files and folders safely", () => {
    expect(fileNameFor("clip-3", wav([]))).toBe("clip-3.wav");
    expect(fileNameFor("ir/../x", new Blob([], { type: "audio/mpeg" }))).toBe("ir_.._x.mp3");
    expect(safeName('  My: "Song"/ 2 ')).toBe("My- -Song- 2");
    expect(safeName("   ")).toBe("Untitled");
  });

  it("saves take lanes and gets them back", () => {
    const lanes: Record<string, TakeLane[]> = {
      a: [{ id: "take-1", name: "Take 1", clips: [{ id: "c9", kind: "audio", offset: 2, length: 1, url: "blob:x", fileName: "x.wav", durationSeconds: 4, peaks: [], sourceOffset: 1, fadeIn: 0, fadeOut: 0, gainDb: 0, loopLength: null }] }],
    };
    const back = deserializeTakes(serializeTakes(lanes), (id) => `blob:${id}`);
    expect(back.a[0]).toMatchObject({ id: "take-1", name: "Take 1" });
    expect(back.a[0].clips[0]).toMatchObject({ id: "c9", url: "blob:c9", sourceOffset: 1 });
    // A track's clip keeps which take it came from.
    const comp: Record<string, ClipInstance[]> = { a: [{ ...lanes.a[0].clips[0], id: "c10", take: "take-1" }] };
    expect(deserializeClips(serializeClips(comp), () => "blob:y").a[0].take).toBe("take-1");
  });

  it("saves a clip's name and color, and gets them back", () => {
    const clips: Record<string, ClipInstance[]> = {
      m: [{ id: "c1", kind: "midi", offset: 0, length: 1, notes: [], loopLength: null, name: "Hook", color: "#ff0000" }],
      a: [{ id: "c2", kind: "audio", offset: 0, length: 1, url: "blob:x", fileName: "x.wav", durationSeconds: 1, peaks: [], sourceOffset: 0, fadeIn: 0, fadeOut: 0, gainDb: 0, loopLength: null, name: "Vox" }],
    };
    const back = deserializeClips(serializeClips(clips), () => "blob:y");
    expect(back.m[0]).toMatchObject({ name: "Hook", color: "#ff0000" });
    expect(back.a[0]).toMatchObject({ name: "Vox", url: "blob:y" });
    expect("color" in back.a[0]).toBe(false);
  });

  it("knows which clips the project and its history use", () => {
    expect([...referencedClipIds(doc())].sort()).toEqual(["clip-1", "clip-2"]);
  });
});
