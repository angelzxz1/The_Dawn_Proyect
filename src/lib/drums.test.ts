import { describe, expect, it } from "vitest";
import { DRUM_SOURCE } from "./drumKernel";
import {
  DRUM_MODELS,
  PAD_KEY_ORDER,
  PAD_KEYS,
  compileDrumKit,
  defaultDrumKit,
  defaultPad,
  normalizeDrumKit,
  padIndexForMidi,
  padNote,
  type DrumKitParams,
} from "./drumParams";

const SR = 48000;
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteNameToMidi = (n: string) => NAMES.indexOf(n.slice(0, -1)) + (parseInt(n.slice(-1), 10) + 1) * 12;

interface Kernel {
  setSettings(s: unknown): void;
  setSample(pad: number, data: Float32Array[] | null): void;
  addEvent(e: { type: string; note?: number; vel?: number; time: number }): void;
  process(outL: Float32Array, outR: Float32Array, n: number, now: number): void;
  activeCount(): number;
  takeState(): { hits: number; peak: number; voices: number };
}
const Drums = new Function(`${DRUM_SOURCE}; return DawnDrumKernel;`)() as new (sr: number) => Kernel;

function make(edit: (k: DrumKitParams) => void = () => {}) {
  const kit = defaultDrumKit();
  edit(kit);
  const k = new Drums(SR);
  k.setSettings(compileDrumKit(kit));
  return { k, kit };
}

function render(k: Kernel, seconds: number, start = 0) {
  const n = Math.round(seconds * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const bl = new Float32Array(128);
  const br = new Float32Array(128);
  for (let i = 0; i < n; i += 128) {
    const len = Math.min(128, n - i);
    k.process(bl, br, len, start + i / SR);
    L.set(bl.subarray(0, len), i);
    R.set(br.subarray(0, len), i);
  }
  return { L, R };
}

const rms = (d: Float32Array, from = 0, to = d.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += d[i] * d[i];
  return Math.sqrt(s / Math.max(1, to - from));
};
const peak = (d: Float32Array, from = 0, to = d.length) => {
  let p = 0;
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(d[i]));
  return p;
};
const ms = (t: number) => Math.round((t / 1000) * SR);

describe("drum voices", () => {
  it("every model sounds, stays in range, and dies away", () => {
    DRUM_MODELS.forEach((model) => {
      [0, 1].forEach((extreme) => {
        const { k } = make((kit) => {
          kit.pads[0] = defaultPad({ model, level: 0, decay: extreme, tone: extreme, character: extreme, drive: extreme, resonance: extreme, filter: extreme ? -0.3 : 0 });
        });
        k.addEvent({ type: "on", note: 24, vel: 1, time: 0 });
        const { L } = render(k, 5);
        expect(L.every((v) => Number.isFinite(v)), model).toBe(true);
        expect(peak(L), `${model} ${extreme}`).toBeGreaterThan(0.05);
        expect(peak(L), `${model} ${extreme}`).toBeLessThan(2);
        expect(k.activeCount(), `${model} ${extreme} still ringing`).toBe(0);
      });
    });
  });

  it("starts a hit on its exact sample", () => {
    const { k } = make();
    k.addEvent({ type: "on", note: 24, vel: 1, time: 0.01 });
    const { L } = render(k, 0.05);
    expect(peak(L, 0, 480)).toBe(0);
    expect(peak(L, 480, 600)).toBeGreaterThan(0.01);
  });

  it("gives the default kit's old ten sounds their old notes", () => {
    const kit = defaultDrumKit();
    // The notes the old ten-pad kit used (C1 = 24 here).
    const byName = (name: string) => kit.pads[padIndexForMidi(noteNameToMidi(name))];
    expect(byName("C1").model).toBe("kick");
    expect(byName("D1").model).toBe("snare");
    expect(byName("E1").model).toBe("clap");
    expect(["F1", "G1", "A1"].map((n) => byName(n).model)).toEqual(["tom", "tom", "tom"]);
    expect(byName("F#1").name).toBe("Closed Hat");
    expect(byName("A#1").name).toBe("Open Hat");
    expect(byName("C#2").name).toBe("Crash");
    expect(byName("D#2").name).toBe("Ride");
    // A S D F G H J K L ; still play kick, snare, clap, the toms, the hats, crash and ride.
    expect(PAD_KEY_ORDER.slice(0, 10).map((i) => kit.pads[i].name)).toEqual([
      "Kick",
      "Snare",
      "Clap",
      "Low Tom",
      "Mid Tom",
      "High Tom",
      "Closed Hat",
      "Open Hat",
      "Crash",
      "Ride",
    ]);
    expect(new Set(PAD_KEY_ORDER).size).toBe(16);
    expect(PAD_KEYS).toHaveLength(16);
  });

  it("tunes, velocity and the filter", () => {
    const hitRms = (edit: (k: DrumKitParams) => void, vel = 1) => {
      const { k } = make(edit);
      k.addEvent({ type: "on", note: 24, vel, time: 0 });
      return render(k, 0.3).L;
    };
    // Velocity sets the level.
    const loud = rms(hitRms((k) => (k.pads[0].velocity = 1), 1));
    const soft = rms(hitRms((k) => (k.pads[0].velocity = 1), 0.3));
    expect(soft / loud).toBeLessThan(0.45);
    // A low-pass filter darkens a hat.
    const open = hitRms((k) => (k.pads[0] = defaultPad({ model: "hat", decay: 0.5 })));
    const dark = hitRms((k) => (k.pads[0] = defaultPad({ model: "hat", decay: 0.5, filter: -0.5 })));
    expect(rms(dark)).toBeLessThan(rms(open) * 0.3);
    // Muted pads are silent.
    expect(peak(hitRms((k) => (k.pads[0].mute = true)))).toBe(0);
  });

  it("chokes: a closed hat cuts off the open hat", () => {
    const openThenClosed = (choke: number) => {
      const { k } = make((kit) => {
        kit.pads[10].choke = choke; // open hat
        kit.pads[6].choke = choke; // closed hat
        kit.pads[6].level = -60;
      });
      k.addEvent({ type: "on", note: 34, vel: 1, time: 0 });
      k.addEvent({ type: "on", note: 30, vel: 1, time: 0.05 });
      return render(k, 0.2).L;
    };
    const after = (d: Float32Array) => rms(d, ms(70), ms(120));
    expect(after(openThenClosed(1))).toBeLessThan(after(openThenClosed(0)) * 0.01);
  });

  it("limits how many hits of one pad ring at once", () => {
    const { k } = make((kit) => (kit.pads[0].decay = 1));
    for (let i = 0; i < 10; i++) k.addEvent({ type: "on", note: 24, vel: 1, time: i * 0.01 });
    render(k, 0.2);
    expect(k.activeCount()).toBeLessThanOrEqual(4);
    expect(k.takeState().hits).toBe(1);
  });
});

describe("sample pads", () => {
  const ramp = () => new Float32Array(4800).map((_, i) => (i + 1) / 4800); // 0.1 s rising ramp

  function play(edit: (kit: DrumKitParams) => void, data: Float32Array[]) {
    const { k } = make((kit) => {
      kit.pads[2] = defaultPad({ source: "sample", sample: { id: "s", name: "ramp" }, level: 0, velocity: 0, decay: 1 });
      edit(kit);
    });
    k.setSample(2, data);
    k.addEvent({ type: "on", note: 26, vel: 1, time: 0 });
    return render(k, 0.2);
  }

  it("plays the sample through, tuned by resampling", () => {
    const { L } = play(() => {}, [ramp()]);
    expect(L[2400]).toBeCloseTo(2401 / 4800, 2);
    expect(peak(L, 4810)).toBe(0);
    const up = play((kit) => (kit.pads[2].tune = 12), [ramp()]).L;
    expect(up[1200]).toBeCloseTo(2401 / 4800, 2); // twice as fast
    expect(peak(up, 2410)).toBe(0);
  });

  it("reverses, starts later, fades out, and plays stereo", () => {
    const rev = play((kit) => (kit.pads[2].reverse = true), [ramp()]).L;
    expect(rev[10]).toBeGreaterThan(0.99);
    expect(rev[4000]).toBeLessThan(0.2);
    const late = play((kit) => (kit.pads[2].start = 0.5), [ramp()]).L;
    expect(late[0]).toBeCloseTo(0.5, 2);
    const short = play((kit) => (kit.pads[2].decay = 0), [ramp()]).L;
    expect(rms(short, 3000, 4000)).toBeLessThan(0.01);
    const st = play(() => {}, [ramp(), new Float32Array(4800)]);
    expect(peak(st.L)).toBeGreaterThan(0.5);
    expect(peak(st.R)).toBe(0);
  });

  it("stays quiet with no sample loaded", () => {
    const { L } = play(() => {}, []);
    expect(peak(L)).toBe(0);
  });
});

describe("drum kits", () => {
  it("repairs saved kits and starts old drum tracks on the default kit", () => {
    const kit = defaultDrumKit();
    kit.pads[3] = defaultPad({ name: "Vox", source: "sample", sample: { id: "file-1", name: "vox.wav" }, choke: 2 });
    expect(normalizeDrumKit(JSON.parse(JSON.stringify(kit)))).toEqual(kit);
    expect(normalizeDrumKit(undefined)).toEqual(defaultDrumKit());
    const bad = normalizeDrumKit({ version: 1, pads: [{ model: "tuba", tune: 99, source: "sample" }], volume: "loud" });
    expect(bad.pads[0].model).toBe("kick");
    expect(bad.pads[0].tune).toBe(24);
    expect(bad.pads[0].source).toBe("synth"); // no sample to play
    expect(bad.pads).toHaveLength(16);
    expect(bad.volume).toBe(0);
    expect(padNote(15)).toBe(39); // D#2
  });
});

describe("factory kits", () => {
  it("every kit is valid and every pad plays at a sane level", async () => {
    const { FACTORY_KITS } = await import("./drumKits");
    const names = new Set<string>();
    for (const preset of FACTORY_KITS) {
      expect(names.has(preset.name)).toBe(false);
      names.add(preset.name);
      expect(normalizeDrumKit(JSON.parse(JSON.stringify(preset.kit)))).toEqual(preset.kit);
      preset.kit.pads.forEach((pad, i) => {
        const k = new Drums(SR);
        k.setSettings(compileDrumKit(preset.kit));
        k.addEvent({ type: "on", note: 24 + i, vel: 0.9, time: 0 });
        const { L } = render(k, 0.4);
        const db = 20 * Math.log10(peak(L));
        expect(db, `${preset.name} / ${pad.name}`).toBeGreaterThan(-36);
        expect(db, `${preset.name} / ${pad.name}`).toBeLessThan(3);
      });
    }
  });
});
