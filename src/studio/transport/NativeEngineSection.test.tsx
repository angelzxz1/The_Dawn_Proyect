// The Audio panel's native engine section, with the desktop app's device
// list stood in for: the switch, the driver and device lists, the buffer
// sizes a device allows, and what of the project it doesn't play yet.

import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "@vitest/browser/context";

vi.mock("@/engine/native/bridge", () => ({
  nativeBridge: {
    devices: async () => [
      {
        id: "Wasapi",
        name: "WASAPI",
        devices: [
          { id: "wasapi:speakers", name: "Speakers", isDefault: true, sampleRates: [44100, 48000], minBuffer: 128, maxBuffer: 1024, defaultSampleRate: 48000 },
          { id: "wasapi:scarlett", name: "Scarlett 2i2", isDefault: false, sampleRates: [44100, 48000, 96000], minBuffer: 32, maxBuffer: 2048, defaultSampleRate: 44100 },
        ],
      },
    ],
  },
}));

import { NativeEngineSection } from "./NativeEngineSection";
import { DEFAULT_AUDIO_PREFS, type AudioPrefs } from "@/engine/audioPrefs";
import { projectStore } from "@/state/projectStore";

function renderSection(prefs: Partial<AudioPrefs> = {}) {
  const update = vi.fn();
  const screen = render(<NativeEngineSection prefs={{ ...DEFAULT_AUDIO_PREFS, ...prefs }} update={update} />);
  return { screen, update };
}

describe("the native engine section", () => {
  test("its switch turns the engine on", async () => {
    const { screen, update } = renderSection();
    await userEvent.click(screen.getByRole("switch", { name: "Native engine" }));
    expect(update).toHaveBeenCalledWith({ nativeEngine: true });
    // The device settings show once it's on.
    expect(screen.container.querySelector("select")).toBeNull();
  });

  test("lists the drivers and devices, and the buffer sizes the device takes", async () => {
    const { screen, update } = renderSection({ nativeEngine: true, nativeDevice: "wasapi:speakers" });
    const device = screen.getByRole("combobox", { name: "Device" });
    await expect.element(device).toHaveValue("wasapi:speakers");
    const buffers = [...screen.getByRole("combobox", { name: "Buffer size" }).element().querySelectorAll("option")].map((o) => o.textContent);
    expect(buffers).toEqual(["Device's own", "128 samples", "256 samples", "512 samples", "1024 samples"]);
    await device.selectOptions("wasapi:scarlett");
    expect(update).toHaveBeenCalledWith({ nativeDevice: "wasapi:scarlett", nativeSampleRate: null, nativeBufferSize: null });
  });

  test("says which tracks it plays without their effects or automation", async () => {
    projectStore.set("channels", [
      { id: "k", name: "Keys", volume: 0, pan: 0, colorIndex: 0, type: "midi", instrument: "synth", muted: false, solo: false, armed: false },
      { id: "v", name: "Vox", volume: 0, pan: 0, colorIndex: 0, type: "audio", instrument: null, muted: false, solo: false, armed: false },
    ]);
    projectStore.set("clipsByChannel", { k: [{ id: "m", kind: "midi", offset: 0, length: 1, notes: [{ note: "C4", time: 0, duration: 0.5, velocity: 0.8 }], loopLength: null }] });
    projectStore.set("channelEffects", { v: [{ id: "fx", type: "compressor", params: {} }] });
    projectStore.set("channels", [
      ...projectStore.get().channels.map((c) =>
        c.id === "k" ? { ...c, automationLanes: [{ id: "l", target: { kind: "volume" as const }, points: [{ id: "p", time: 0, value: 0 }] }] } : c
      ),
    ]);
    const { screen } = renderSection({ nativeEngine: true });
    await expect.element(screen.getByText("Played without their effects: Vox.")).toBeVisible();
    await expect.element(screen.getByText("Without their automation: Keys.")).toBeVisible();
    // The synth plays.
    expect(screen.container.textContent).not.toContain("Silent here");
  });
});
