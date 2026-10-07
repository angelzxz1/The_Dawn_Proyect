import { describe, expect, it } from "vitest";
import { SYNTH_SOURCE } from "./synthKernel";
import {
  DEST_SPECS,
  FILTER_TYPES,
  WARP_MODES,
  compileSynth,
  destValue,
  fromNorm,
  initSynthParams,
  normalizeSynthParams,
  toNorm,
  type SynthParams,
} from "./synthParams";
import {
  MIP_HARMONICS,
  MIP_SIZES,
  WAVETABLE_IDS,
  cycleToSpectrum,
  factoryWavetable,
  mipLevelFor,
  spectrumToCycle,
  subWavetable,
  wavetableFromAudio,
  type WavetableData,
} from "./wavetableModel";

const SR = 48000;

interface Kernel {
  setSettings(s: unknown): void;
  setTable(slot: number, data: WavetableData): void;
  addEvent(e: { type: string; note?: number; vel?: number; time: number }): void;
  process(outL: Float32Array, outR: Float32Array, n: number, now: number): void;
  activeCount(): number;
  takeState(): { voices: number; mod: number[] | null; env: [number, number][] | null };
  bend: number;
  modwheel: number;
  bpm: number;
}
const Synth = new Function(`${SYNTH_SOURCE}; return DawnSynthKernel;`)() as new (sr: number) => Kernel;

function make(edit: (p: SynthParams) => void = () => {}) {
  const p = initSynthParams();
  edit(p);
  const k = new Synth(SR);
  k.setSettings(compileSynth(p));
  k.setTable(0, factoryWavetable(p.osc1.table));
  k.setTable(1, factoryWavetable(p.osc2.table));
  k.setTable(2, subWavetable());
  return { k, p };
}

/** Renders `seconds`, in 128-sample blocks, from context time `start`. */
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

/** Frequency from rising zero crossings. */
function pitchOf(d: Float32Array, from: number, to: number): number {
  let first = -1;
  let last = -1;
  let count = 0;
  for (let i = from + 1; i < to; i++) {
    if (d[i - 1] <= 0 && d[i] > 0) {
      if (first < 0) first = i;
      else count++;
      last = i;
    }
  }
  return count > 0 ? (count * SR) / (last - first) : 0;
}

/** Share of energy above `hz` (a crude brightness measure, via a one-pole split). */
function brightness(d: Float32Array, hz: number): number {
  const a = Math.exp((-2 * Math.PI * hz) / SR);
  let lp = 0;
  let hi = 0;
  let all = 0;
  for (let i = 0; i < d.length; i++) {
    lp = (1 - a) * d[i] + a * lp;
    const h = d[i] - lp;
    hi += h * h;
    all += d[i] * d[i];
  }
  return hi / Math.max(1e-12, all);
}

describe("wavetables", () => {
  it("turns a cycle into harmonics and back", () => {
    const n = 2048;
    const cycle = new Float64Array(n).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 3 * i) / n) + 0.25 * Math.cos((2 * Math.PI * 7 * i) / n));
    const s = cycleToSpectrum(cycle);
    expect(s.sin[3]).toBeCloseTo(0.5, 6);
    expect(s.cos[7]).toBeCloseTo(0.25, 6);
    const back = spectrumToCycle(s, n, 512);
    for (let i = 0; i < n; i += 97) expect(back[i]).toBeCloseTo(cycle[i], 6);
    // Dropping harmonics above 4 removes the 7th.
    const low = cycleToSpectrum(spectrumToCycle(s, 256, 4));
    expect(Math.abs(low.cos[7])).toBeLessThan(1e-9);
    expect(low.sin[3]).toBeCloseTo(0.5, 6);
  });

  it("builds every factory table, peak-normalized and band-limited per level", () => {
    for (const id of WAVETABLE_IDS) {
      const t = factoryWavetable(id);
      expect(t.frames).toBeGreaterThan(1);
      expect(t.levels).toHaveLength(MIP_SIZES.length);
      t.levels.forEach((lvl, l) => expect(lvl.length).toBe(t.frames * MIP_SIZES[l]));
      // Every frame peaks at 1 in the richest level.
      const size = MIP_SIZES[0];
      for (const f of [0, t.frames - 1]) {
        let peak = 0;
        for (let i = 0; i < size; i++) peak = Math.max(peak, Math.abs(t.levels[0][f * size + i]));
        expect(peak, id).toBeCloseTo(1, 3);
      }
      // A thin level really has no harmonics above its cap.
      const l = 4;
      const cyc = t.levels[l].subarray(0, MIP_SIZES[l]);
      const s = cycleToSpectrum(cyc);
      let above = 0;
      for (let k = MIP_HARMONICS[l] + 1; k < MIP_SIZES[l] / 2; k++) above += Math.hypot(s.sin[k], s.cos[k]);
      expect(above, id).toBeLessThan(1e-6);
    }
  });

  it("starts Basic Shapes on a sine", () => {
    const t = factoryWavetable("basic");
    const s = cycleToSpectrum(t.levels[0].subarray(0, MIP_SIZES[0]));
    expect(Math.hypot(s.sin[1], s.cos[1])).toBeCloseTo(1, 3);
    expect(Math.hypot(s.sin[2], s.cos[2]) + Math.hypot(s.sin[3], s.cos[3])).toBeLessThan(1e-6);
  });

  it("picks thinner levels for higher notes", () => {
    expect(mipLevelFor(30, SR)).toBe(0);
    const high = mipLevelFor(4000, SR);
    expect(MIP_HARMONICS[high] * 4000).toBeLessThanOrEqual(28000);
    expect(high).toBeGreaterThan(mipLevelFor(500, SR));
  });

  it("cuts imported audio into cycles", () => {
    const audio = new Float32Array(2048 * 10).map((_, i) => Math.sin((2 * Math.PI * i) / 2048) * (i < 2048 * 5 ? 1 : 0.5));
    const t = wavetableFromAudio(audio);
    expect(t.frames).toBe(10);
    const short = wavetableFromAudio(new Float32Array(300).map((_, i) => Math.sin((2 * Math.PI * i) / 300)));
    expect(short.frames).toBe(1);
  });
});

describe("synth settings", () => {
  it("maps knob positions both ways", () => {
    DEST_SPECS.forEach((spec) => {
      const mid = fromNorm(spec, 0.37);
      expect(toNorm(spec, mid)).toBeCloseTo(0.37, 6);
    });
    const p = initSynthParams();
    DEST_SPECS.forEach((spec) => expect(Number.isFinite(destValue(p, spec.key))).toBe(true));
  });

  it("repairs saved settings and keeps good ones", () => {
    const p = initSynthParams();
    p.osc1.table = "vowels";
    p.filter1.type = "comb";
    p.mods.push({ id: "m1", source: "lfo1", dest: "filter1.cutoff", amount: 0.4, bipolar: true });
    const round = normalizeSynthParams(JSON.parse(JSON.stringify(p)));
    expect(round).toEqual(p);
    const bad = normalizeSynthParams({ version: 2, osc1: { table: "nope", unison: 99 }, mods: [{ source: "x", dest: "y" }, { source: "env2", dest: "osc1.level", amount: 5 }] });
    expect(bad.osc1.table).toBe("basic");
    expect(bad.osc1.unison).toBe(16);
    expect(bad.mods).toHaveLength(1);
    expect(bad.mods[0].amount).toBe(1);
  });

  it("converts the first synth's settings", () => {
    const legacy = {
      oscA: { wavetable: "formant", position: 0.5, octave: -1, semitone: 3, fineCents: 5, level: 0.6, unisonVoices: 3, unisonSpread: 20 },
      oscB: { wavetable: "organ", position: 0.2, octave: 0, semitone: 0, fineCents: 0, level: 0.5, unisonVoices: 1, unisonSpread: 0 },
      oscBEnabled: false,
      subLevel: 0.3,
      subOctaveDown: 2,
      filterType: "highpass",
      filterCutoff: 800,
      filterResonance: 4,
      filterEnvAmount: 3,
      ampAttack: 0.05,
      ampDecay: 0.3,
      ampSustain: 0.7,
      ampRelease: 1,
      filterAttack: 0.01,
      filterDecay: 0.5,
      filterSustain: 0.2,
      filterRelease: 0.4,
      lfoRate: 5,
      lfoAmount: 0.5,
      lfoTarget: "pitch",
      glide: 0.1,
    };
    const p = normalizeSynthParams(legacy);
    expect(p.version).toBe(2);
    expect(p.osc1.table).toBe("vowels");
    expect(p.osc1.transpose).toBe(-9);
    expect(p.osc1.unison).toBe(3);
    expect(p.osc2.on).toBe(false);
    expect(p.sub).toMatchObject({ on: true, octave: -2, level: 0.3 });
    expect(p.filter1).toMatchObject({ type: "hp12", cutoff: 800 });
    expect(p.envs[0]).toMatchObject({ attack: 0.05, sustain: 0.7, release: 1 });
    expect(p.mods.some((m) => m.source === "env2" && m.dest === "filter1.cutoff" && m.amount > 0)).toBe(true);
    expect(p.mods.filter((m) => m.source === "lfo1")).toHaveLength(2);
    expect(p.voice.glide).toBe(0.1);
    // Junk becomes the init sound.
    expect(normalizeSynthParams("broken")).toEqual(initSynthParams());
  });
});

describe("synth kernel", () => {
  it("plays a note at its pitch, starting on its sample, and stops after release", () => {
    const { k } = make((p) => {
      p.osc1.position = 0; // sine
      p.envs[0].release = 0.05;
    });
    k.addEvent({ type: "on", note: 69, vel: 1, time: 0.01 });
    k.addEvent({ type: "off", note: 69, time: 0.3 });
    const { L } = render(k, 0.6);
    // Silent before the note.
    expect(rms(L, 0, 470)).toBe(0);
    expect(Math.abs(L[490])).toBeGreaterThan(0);
    expect(pitchOf(L, 4800, 14000)).toBeCloseTo(440, 0);
    expect(rms(L, 4800, 14000)).toBeGreaterThan(0.1);
    // Released and gone.
    expect(rms(L, 0.45 * SR, 0.6 * SR)).toBeLessThan(1e-4);
    expect(k.activeCount()).toBe(0);
  });

  it("transposes, detunes and bends", () => {
    const { k } = make((p) => {
      p.osc1.position = 0;
      p.osc1.transpose = 12;
      p.voice.bendRange = 2;
    });
    k.addEvent({ type: "on", note: 57, vel: 1, time: 0 });
    const a = render(k, 0.2).L;
    expect(pitchOf(a, 2400, 9000)).toBeCloseTo(440, 0);
    k.bend = 1;
    const b = render(k, 0.2, 0.2).L;
    expect(pitchOf(b, 2400, 9000)).toBeCloseTo(440 * Math.pow(2, 2 / 12), 0);
  });

  it("spreads unison voices across the stereo field", () => {
    const mono = make((p) => (p.osc1.unison = 1));
    mono.k.addEvent({ type: "on", note: 60, vel: 1, time: 0 });
    const m = render(mono.k, 0.3);
    let diff = 0;
    for (let i = 0; i < m.L.length; i++) diff += Math.abs(m.L[i] - m.R[i]);
    expect(diff).toBeLessThan(1e-3);

    const wide = make((p) => {
      p.osc1.unison = 7;
      p.osc1.detune = 0.5;
      p.osc1.width = 1;
    });
    wide.k.addEvent({ type: "on", note: 60, vel: 1, time: 0 });
    const w = render(wide.k, 0.3);
    diff = 0;
    for (let i = 0; i < w.L.length; i++) diff += Math.abs(w.L[i] - w.R[i]);
    expect(diff / w.L.length).toBeGreaterThan(0.05);
    // Unison keeps roughly the same loudness.
    expect(rms(w.L, 4800) / rms(m.L, 4800)).toBeGreaterThan(0.5);
    expect(rms(w.L, 4800) / rms(m.L, 4800)).toBeLessThan(2);
  });

  it("darkens with a low cutoff", () => {
    const tone = (cutoff: number) => {
      const { k } = make((p) => {
        p.osc1.position = 0.5; // saw
        p.filter1.cutoff = cutoff;
      });
      k.addEvent({ type: "on", note: 48, vel: 1, time: 0 });
      return render(k, 0.3).L.subarray(4800);
    };
    expect(brightness(tone(300), 2000)).toBeLessThan(brightness(tone(20000), 2000) * 0.2);
  });

  it("keeps every filter stable at full resonance and drive", () => {
    FILTER_TYPES.forEach((type) => {
      const { k } = make((p) => {
        p.noise.on = true;
        p.noise.level = 1;
        p.filter1 = { ...p.filter1, type, cutoff: 3000, resonance: 1, drive: 1, morph: 0.5, keytrack: 1 };
        p.filter2 = { ...p.filter2, on: true, type, cutoff: 200, resonance: 1 };
        p.mods.push({ id: "m", source: "lfo1", dest: "filter1.cutoff", amount: 1, bipolar: true });
        p.lfos[0] = { ...p.lfos[0], sync: false, rate: 20 };
      });
      k.addEvent({ type: "on", note: 60, vel: 1, time: 0 });
      k.addEvent({ type: "on", note: 84, vel: 1, time: 0.1 });
      const { L, R } = render(k, 0.5);
      for (let i = 0; i < L.length; i++) {
        if (!(Math.abs(L[i]) < 20) || !(Math.abs(R[i]) < 20)) throw new Error(`${type} blew up at ${i}: ${L[i]}`);
      }
      expect(rms(L, 4800), type).toBeGreaterThan(1e-4);
    });
  });

  it("runs every warp without trouble, and FM changes the sound", () => {
    const out: Record<string, number> = {};
    WARP_MODES.forEach((warp) => {
      const { k } = make((p) => {
        p.osc1.position = 0;
        p.osc1.warp = warp;
        p.osc1.warpAmount = 0.6;
        p.osc2.on = true;
        p.osc2.level = 0;
        p.osc2.position = 0;
      });
      k.addEvent({ type: "on", note: 60, vel: 1, time: 0 });
      const { L } = render(k, 0.2);
      L.forEach((v) => expect(Number.isFinite(v)).toBe(true));
      out[warp] = brightness(L.subarray(2400), 600);
    });
    expect(out.fm).toBeGreaterThan(out.none * 3);
    expect(out.sync).toBeGreaterThan(out.none * 3);
  });

  it("shapes the level with the amp envelope", () => {
    const { k } = make((p) => {
      p.osc1.position = 0;
      p.envs[0] = { ...p.envs[0], attack: 0.1, attackCurve: 0, decay: 0.1, sustain: 0.5, decayCurve: 0 };
    });
    k.addEvent({ type: "on", note: 60, vel: 1, time: 0 });
    const { L } = render(k, 0.5);
    const at = (s: number) => rms(L, Math.round(s * SR) - 200, Math.round(s * SR) + 200);
    expect(at(0.05) / at(0.1)).toBeGreaterThan(0.4);
    expect(at(0.05) / at(0.1)).toBeLessThan(0.6);
    expect(at(0.4) / at(0.1)).toBeCloseTo(0.5, 1);
  });

  it("modulates through the matrix: an LFO sweeps, a macro moves a knob", () => {
    const { k } = make((p) => {
      p.lfos[0] = { ...p.lfos[0], sync: false, rate: 4, shape: "square" };
      p.mods.push({ id: "a", source: "lfo1", dest: "osc1.level", amount: -0.7, bipolar: false });
      p.macros[1] = 1;
      p.mods.push({ id: "b", source: "macro2", dest: "filter1.cutoff", amount: -0.5, bipolar: false });
    });
    k.addEvent({ type: "on", note: 60, vel: 1, time: 0 });
    const { L } = render(k, 0.5);
    // Square LFO at 4 Hz: high for the first half cycle (level pulled to 0), then low.
    const lo = rms(L, Math.round(0.02 * SR), Math.round(0.1 * SR));
    const hi = rms(L, Math.round(0.14 * SR), Math.round(0.22 * SR));
    expect(lo / hi).toBeLessThan(0.5);
    const state = k.takeState();
    const cutoffIdx = DEST_SPECS.findIndex((d) => d.key === "filter1.cutoff");
    expect(state.mod![cutoffIdx]).toBeCloseTo(0.5, 3);
  });

  it("limits polyphony, stealing the oldest note", () => {
    const { k } = make((p) => (p.voice.polyphony = 2));
    [60, 64, 67].forEach((note, i) => k.addEvent({ type: "on", note, vel: 1, time: i * 0.05 }));
    render(k, 0.3);
    expect(k.activeCount()).toBe(2);
  });

  it("glides in legato mode without restarting the envelope", () => {
    const { k } = make((p) => {
      p.osc1.position = 0;
      p.voice.mode = "legato";
      p.voice.glide = 0.1;
      p.envs[0] = { ...p.envs[0], attack: 0.05, decay: 0.05, sustain: 0.3 };
    });
    k.addEvent({ type: "on", note: 57, vel: 1, time: 0 });
    k.addEvent({ type: "on", note: 69, vel: 1, time: 0.3 });
    const { L } = render(k, 0.6);
    expect(k.activeCount()).toBe(1);
    // Still at the sustain level (no new attack peak) right after the second note.
    const before = rms(L, Math.round(0.25 * SR), Math.round(0.29 * SR));
    const after = rms(L, Math.round(0.33 * SR), Math.round(0.37 * SR));
    expect(after / before).toBeLessThan(1.3);
    // Mid-glide pitch is between the notes, then it arrives.
    const mid = pitchOf(L, Math.round(0.33 * SR), Math.round(0.37 * SR));
    expect(mid).toBeGreaterThan(230);
    expect(mid).toBeLessThan(420);
    expect(pitchOf(L, Math.round(0.45 * SR), Math.round(0.6 * SR))).toBeCloseTo(440, 0);
    // Letting go of the top note glides back to the one still held.
    k.addEvent({ type: "off", note: 69, time: 0.6 });
    const back = render(k, 0.4, 0.6).L;
    expect(pitchOf(back, Math.round(0.2 * SR), Math.round(0.4 * SR))).toBeCloseTo(220, 0);
  });

  it("stays quiet with nothing playing and survives settings changes mid-note", () => {
    const { k, p } = make();
    expect(rms(render(k, 0.05).L)).toBe(0);
    k.addEvent({ type: "on", note: 60, vel: 0.8, time: 0.05 });
    render(k, 0.1, 0.05);
    p.osc1.unison = 9;
    p.filter1.type = "comb";
    p.osc2.on = true;
    p.osc2.warp = "rm";
    k.setSettings(compileSynth(p));
    const { L } = render(k, 0.2, 0.15);
    L.forEach((v) => expect(Number.isFinite(v)).toBe(true));
    expect(rms(L)).toBeGreaterThan(0.01);
  });
});

describe("synth presets", () => {
  it("every factory preset is valid, plays, and survives a save/load round trip", async () => {
    const { FACTORY_SYNTH_PRESETS } = await import("./synthPresets");
    const names = new Set<string>();
    for (const preset of FACTORY_SYNTH_PRESETS) {
      expect(names.has(preset.name)).toBe(false);
      names.add(preset.name);
      expect(normalizeSynthParams(JSON.parse(JSON.stringify(preset.params)))).toEqual(preset.params);
      const k = new Synth(SR);
      k.setSettings(compileSynth(preset.params));
      k.setTable(0, factoryWavetable(preset.params.osc1.table));
      k.setTable(1, factoryWavetable(preset.params.osc2.table));
      k.setTable(2, subWavetable());
      k.addEvent({ type: "on", note: 60, vel: 0.9, time: 0 });
      k.addEvent({ type: "on", note: 64, vel: 0.9, time: 0 });
      k.addEvent({ type: "off", note: 60, time: 0.6 });
      k.addEvent({ type: "off", note: 64, time: 0.6 });
      const { L, R } = render(k, 1.0);
      let peak = 0;
      for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
      // Riser takes seconds to fade in; everything else speaks within the note.
      if (preset.name !== "Riser") expect(peak, preset.name).toBeGreaterThan(0.02);
      expect(peak, preset.name).toBeLessThan(2.5);
    }
  });
});
