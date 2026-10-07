import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { packFileName, packId, packPathKind, readPack, writePack, type PackContents } from "./dawnPack";
import { parsePackGrooves } from "../lib/grooves";

const manifest = { format: "dawnpack" as const, schema: 1, name: "Classic Rock Tones", version: "1.0", author: "Angel", license: "Supporters" };

function pack(extra: Partial<PackContents> = {}): PackContents {
  return { manifest, effectPresets: [], synthPresets: [], kits: [], grooves: [], files: [], ...extra };
}

describe(".dawnpack", () => {
  it("round-trips presets, kits, grooves and files", () => {
    const original = pack({
      effectPresets: [{ id: "user:1", type: "reverb", name: "Big Room", params: { decay: 2 } }],
      kits: [{ name: "Garage Kit", kit: { version: 1, pads: [], volume: 0 } }],
      grooves: [{ name: "Garage", bpm: 120, sections: { verse: { kick: "x...x...x...x..." } } }],
      files: [{ path: "irs/Garage 2x12.wav", data: new Uint8Array([1, 2, 3]) }],
    });
    const read = readPack(writePack(original));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.pack.manifest).toMatchObject(manifest);
    expect(read.pack.effectPresets).toEqual(original.effectPresets);
    expect(read.pack.kits).toEqual(original.kits);
    expect(read.pack.grooves).toEqual(original.grooves);
    expect(read.pack.files).toEqual(original.files);
  });

  it("refuses anything that isn't data, or doesn't fit", () => {
    const zip = (files: Record<string, Uint8Array>) => zipSync(files);
    const m = strToU8(JSON.stringify(manifest));
    const refuse = (bytes: Uint8Array, text: RegExp) => {
      const r = readPack(bytes);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(text);
    };
    refuse(strToU8("not a zip"), /isn't a ZIP/);
    refuse(zip({ "manifest.json": m, "presets/hack.js": strToU8("alert(1)") }), /hack\.js/);
    refuse(zip({ "manifest.json": m, "../escape.wav": new Uint8Array(4) }), /isn't something a pack can hold/);
    refuse(zip({ "manifest.json": m, "irs/sub/deep.wav": new Uint8Array(4) }), /isn't something a pack can hold/);
    refuse(zip({ "presets/effects.json": strToU8("[]") }), /no manifest/);
    refuse(zip({ "manifest.json": strToU8('{"format":"dawnpack","schema":99,"name":"X"}') }), /newer version/);
    refuse(zip({ "manifest.json": m, "presets/effects.json": strToU8('{"not":"a list"}') }), /isn't a list/);
    refuse(zip({ "manifest.json": m }), /empty/);
    refuse(new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9]), /damaged/);
  });

  it("names paths and files safely", () => {
    expect(packPathKind("nam/Plexi.nam")).toBe("nam");
    expect(packPathKind("samples/kick.flac")).toBe("sample");
    expect(packPathKind("nam/Plexi.wav")).toBeNull();
    expect(packPathKind("samples/./x.wav")).toBeNull();
    expect(packId("Classic Rock Tones!")).toBe("classic-rock-tones");
    const used = new Set<string>();
    expect(packFileName("My Kick?.WAV", used)).toBe("My Kick.wav");
    expect(packFileName("My Kick.wav", used)).toBe("My Kick 2.wav");
  });

  it("keeps only well-formed pack grooves", () => {
    const genres = parsePackGrooves(
      [
        { name: "Good", bpm: 100, sections: { verse: { kick: "x...x...x...x...", snare: "....x.......x..." }, fill: { snare: "xxxxxxxxxxxxxxxx" } } },
        { name: "Wrong length", sections: { verse: { kick: "x...x..." } } },
        { name: "Bad role", sections: { verse: { tuba: "x...x...x...x..." } } },
        { name: "Bad chars", sections: { verse: { kick: "x...<script>...." } } },
      ],
      "p"
    );
    expect(genres.map((g) => g.name)).toEqual(["Good"]);
    expect(Object.keys(genres[0].sections)).toEqual(["verse", "fill"]);
    expect(genres[0].pack).toBe("p");
  });
});
