import { describe, expect, it } from "vitest";
import { normalizeProject } from "./projectSchema";
import { findPreset } from "./presets";
import { PROJECT_TEMPLATES } from "./templates";

describe("project templates", () => {
  it("each builds a valid project that survives saving and loading unchanged", () => {
    for (const t of PROJECT_TEMPLATES) {
      const p = t.build();
      expect(p.channels.length, t.id).toBeGreaterThan(0);
      const again = normalizeProject(JSON.parse(JSON.stringify(p)));
      expect({ ...again, savedAt: 0 }, t.id).toEqual({ ...p, savedAt: 0 });
    }
  });

  it("has sound to play or a track ready to record (except Empty)", () => {
    for (const t of PROJECT_TEMPLATES.filter((x) => x.id !== "empty")) {
      const p = t.build();
      const notes = Object.values(p.clipsByChannel).flat().reduce((n, c) => n + (c.kind === "midi" ? c.notes.length : 0), 0);
      const armedAudio = p.channels.some((c) => c.armed && c.type === "audio");
      expect(notes > 0 || armedAudio, t.id).toBe(true);
      // Effects loaded from presets keep a valid preset reference.
      Object.values(p.channelEffects)
        .flat()
        .forEach((fx) => fx.preset && expect(findPreset(fx.preset.id)?.type, `${t.id} ${fx.preset.id}`).toBe(fx.type));
    }
  });

  it("wires the beat's bass to duck under the drums, and sends to existing buses", () => {
    const beat = PROJECT_TEMPLATES.find((t) => t.id === "beat")!.build();
    const drums = beat.channels.find((c) => c.name === "808 Drums")!;
    const bass = beat.channels.find((c) => c.name === "Bass")!;
    const comp = beat.channelEffects[bass.id].find((fx) => fx.type === "compressor")!;
    expect(comp.sidechain).toEqual({ on: true, source: drums.id, tap: "postFx" });
    for (const t of PROJECT_TEMPLATES) {
      const p = t.build();
      const busIds = new Set(p.buses.map((b) => b.id));
      p.channels.forEach((c) => Object.keys(c.sends ?? {}).forEach((b) => expect(busIds.has(b), `${t.id} ${c.name}`).toBe(true)));
    }
  });

  it("guitar demo: drums arranged over 20 bars, guitar armed with a cabinet", () => {
    const p = PROJECT_TEMPLATES.find((t) => t.id === "guitar-demo")!.build();
    const drums = p.channels.find((c) => c.instrument === "drums")!;
    const clips = p.clipsByChannel[drums.id];
    const end = Math.max(...clips.map((c) => c.offset + c.length));
    expect(end).toBeCloseTo((20 * 4 * 60) / 110, 6);
    const guitar = p.channels.find((c) => c.name === "Guitar")!;
    expect(guitar.armed).toBe(true);
    expect(p.channelEffects[guitar.id].find((fx) => fx.type === "irLoader")?.file?.id).toBe("factory-ir:2x12-combo");
    expect(p.channelEffects[guitar.id].some((fx) => fx.type === "reverb")).toBe(false); // the bus does that
  });
});

describe("template arrangements", () => {
  it("never overlaps two clips on one track", () => {
    for (const t of PROJECT_TEMPLATES) {
      const p = t.build();
      for (const [id, clips] of Object.entries(p.clipsByChannel)) {
        const sorted = [...clips].sort((a, b) => a.offset - b.offset);
        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i].offset, `${t.id} ${id}`).toBeGreaterThanOrEqual(sorted[i - 1].offset + sorted[i - 1].length - 1e-9);
        }
      }
    }
  });
});
