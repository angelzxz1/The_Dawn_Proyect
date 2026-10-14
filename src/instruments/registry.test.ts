import { describe, expect, it } from "vitest";
import {
  INSTRUMENT_LABELS,
  INSTRUMENT_TYPES,
  changedInstrumentSettings,
  readInstrumentSettings,
  startingSettings,
} from "./registry";
import { initSynthParams } from "./synth/synthParams";
import { defaultDrumKit } from "./drum-rack/drumParams";

describe("instrument registry", () => {
  it("every instrument has a unique key and label, in the picker's order", () => {
    expect(INSTRUMENT_TYPES).toEqual(["piano", "drums", "synth"]);
    const labels = INSTRUMENT_TYPES.map((t) => INSTRUMENT_LABELS[t]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("an instrument starts from its defaults the first time, and keeps what was dialed in after that", () => {
    expect(startingSettings({}, "synth")).toEqual({ synthParams: initSynthParams() });
    expect(startingSettings({}, "drums")).toEqual({ drumParams: defaultDrumKit() });
    expect(startingSettings({}, "piano")).toEqual({});
    expect(startingSettings({}, null)).toEqual({});
    const synthParams = { ...initSynthParams(), preset: "Mine" };
    expect(startingSettings({ synthParams }, "synth")).toEqual({});
    expect(startingSettings({ synthParams }, "drums")).toEqual({ drumParams: defaultDrumKit() });
  });

  it("a saved track reads back only the settings of the instrument it plays", () => {
    const saved = { synthParams: initSynthParams(), drumParams: defaultDrumKit() };
    expect(Object.keys(readInstrumentSettings("synth", saved))).toEqual(["synthParams"]);
    expect(Object.keys(readInstrumentSettings("drums", saved))).toEqual(["drumParams"]);
    expect(readInstrumentSettings("piano", saved)).toEqual({});
    expect(readInstrumentSettings(null, saved)).toEqual({});
    // Missing or broken settings come back as the defaults.
    expect(readInstrumentSettings("synth", {})).toEqual({ synthParams: initSynthParams() });
  });

  it("finds only the settings that changed", () => {
    const synthParams = initSynthParams();
    const drumParams = defaultDrumKit();
    expect(changedInstrumentSettings({ synthParams, drumParams }, { synthParams, drumParams })).toBeNull();
    const newKit = defaultDrumKit();
    expect(changedInstrumentSettings({ synthParams, drumParams }, { synthParams, drumParams: newKit })).toEqual({ drumParams: newKit });
    expect(changedInstrumentSettings({ synthParams }, {})).toBeNull();
  });
});
