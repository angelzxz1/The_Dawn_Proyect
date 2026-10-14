// The FX rack on its own: the instrument slot, the effect cards and their
// buttons, dropping effects in from the browser and reordering them, the
// sends, and where the track's audio comes from and goes to - each checked
// by what the rack asks of the studio (its callbacks).

import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "@vitest/browser/context";
import type { ComponentProps } from "react";
import { FxRack } from "./FxRack";
import { EFFECT_DRAG_MIME, PRESET_DRAG_MIME } from "./EffectBrowser";
import { TRACK_COLOR_PALETTE } from "@/project/colors";
import { defaultParams, type EffectInstance, type EffectType } from "@/effects/registry";
import { INSTRUMENT_LABELS } from "@/instruments/registry";

function effect(id: string, type: EffectType, bypass = false): EffectInstance {
  return { id, type, params: defaultParams(type), bypass };
}

function renderRack(props: Partial<ComponentProps<typeof FxRack>> = {}) {
  const callbacks = {
    onAddEffect: vi.fn(),
    onRemoveEffect: vi.fn(),
    onMoveEffect: vi.fn(),
    onBypassToggle: vi.fn(),
    onParamChange: vi.fn(),
    onOpenEffectWindow: vi.fn(),
    onInstrumentChange: vi.fn(),
    onSendChange: vi.fn(),
    onParamDragStart: vi.fn(),
  };
  const screen = render(
    <FxRack channelName="Lead" channelType="midi" color={TRACK_COLOR_PALETTE[0]} instrument="synth" effects={[]} bpm={120} {...callbacks} {...props} />
  );
  return { screen, ...callbacks };
}

/** The drop target at a place in the chain (0 is before the first effect). */
const gap = (index: number) => document.querySelector(`[data-drop-gap="${index}"]`)!;

/** Drops what a drag carries (by type) on an element, as the browser would
 * when a drag from the effect browser or a card's handle ends there. */
function drop(target: Element, data: DataTransfer) {
  for (const type of ["dragenter", "dragover", "drop"]) {
    target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
  }
}

function carrying(entries: Record<string, string>): DataTransfer {
  const data = new DataTransfer();
  for (const [type, value] of Object.entries(entries)) data.setData(type, value);
  return data;
}

describe("the instrument slot", () => {
  test("a MIDI track picks its instrument there, or none", async () => {
    const { screen, onInstrumentChange } = renderRack();
    const slot = screen.getByRole("group", { name: "Instrument" });
    await expect.element(slot.getByRole("button", { name: INSTRUMENT_LABELS.synth })).toHaveAttribute("aria-pressed", "true");
    await slot.getByRole("button", { name: INSTRUMENT_LABELS.drums }).click();
    expect(onInstrumentChange).toHaveBeenCalledWith("drums");
    await slot.getByRole("button", { name: "None" }).click();
    expect(onInstrumentChange).toHaveBeenLastCalledWith(null);
  });

  test("with none loaded, it says the track is silent", async () => {
    const { screen } = renderRack({ instrument: null });
    await expect.element(screen.getByText(/No instrument loaded/)).toBeVisible();
  });

  test("audio tracks and buses have no instrument slot", async () => {
    const { screen } = renderRack({ channelType: "audio", instrument: null });
    await expect.element(screen.getByRole("group", { name: "Instrument" })).not.toBeInTheDocument();
  });
});

describe("the effect cards", () => {
  test("each card's buttons act on its own effect", async () => {
    const { screen, onBypassToggle, onRemoveEffect, onOpenEffectWindow } = renderRack({
      effects: [effect("a", "reverb"), effect("b", "delay")],
    });
    await screen.getByTitle("Bypass effect").nth(1).click();
    expect(onBypassToggle).toHaveBeenCalledWith("b");
    await screen.getByTitle("Expand").nth(0).click();
    expect(onOpenEffectWindow).toHaveBeenCalledWith("a");
    await screen.getByTitle("Remove effect").nth(0).click();
    expect(onRemoveEffect).toHaveBeenCalledWith("a");
  });

  test("a bypassed effect offers to be switched back on", async () => {
    const { screen, onBypassToggle } = renderRack({ effects: [effect("a", "reverb", true)] });
    await screen.getByTitle("Enable effect").click();
    expect(onBypassToggle).toHaveBeenCalledWith("a");
  });

  test("an effect dropped from the browser goes where it's dropped, with its preset", () => {
    const { onAddEffect } = renderRack({ effects: [effect("a", "reverb"), effect("b", "delay")] });
    drop(gap(1), carrying({ [EFFECT_DRAG_MIME]: "chorus" }));
    expect(onAddEffect).toHaveBeenCalledWith("chorus", 1, undefined);
    drop(gap(2), carrying({ [EFFECT_DRAG_MIME]: "reverb", [PRESET_DRAG_MIME]: "factory:reverb:small-room" }));
    expect(onAddEffect).toHaveBeenLastCalledWith("reverb", 2, "factory:reverb:small-room");
  });

  test("an empty rack takes a dropped effect as its first", async () => {
    const { screen, onAddEffect } = renderRack();
    drop(screen.getByText("Drag effects here").element(), carrying({ [EFFECT_DRAG_MIME]: "delay" }));
    expect(onAddEffect).toHaveBeenCalledWith("delay", 0, undefined);
  });

  test("a card dragged by its handle moves to where it's dropped", async () => {
    const { screen, onMoveEffect, onAddEffect } = renderRack({ effects: [effect("a", "reverb"), effect("b", "delay")] });
    const data = new DataTransfer();
    const handle = screen.getByTitle("Drag to reorder").nth(1).element();
    handle.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: data }));
    drop(gap(0), data);
    expect(onMoveEffect).toHaveBeenCalledWith("b", 0);
    expect(onAddEffect).not.toHaveBeenCalled();
  });

  test("the rack folds away and back", async () => {
    const { screen } = renderRack({ effects: [effect("a", "reverb")] });
    await screen.getByTitle("Collapse the FX rack").click();
    await expect.element(screen.getByTitle("Remove effect")).not.toBeInTheDocument();
    await screen.getByTitle("Expand the FX rack").click();
    await expect.element(screen.getByTitle("Remove effect")).toBeVisible();
  });
});

describe("sends and routing", () => {
  const buses = [
    { id: "verb", name: "Reverb", colorIndex: 0 },
    { id: "dly", name: "Echo", colorIndex: 1 },
  ];

  test("a level per bus; typing one sets it, and the bottom turns the send off", async () => {
    const { screen, onSendChange } = renderRack({ buses, sends: { verb: -12 } });
    await expect.element(screen.getByRole("slider", { name: "Reverb" })).toHaveAttribute("aria-valuenow", "-12");
    await expect.element(screen.getByRole("slider", { name: "Echo" })).toHaveAttribute("aria-valuenow", "-60");
    await screen.getByRole("slider", { name: "Echo" }).click();
    await userEvent.fill(screen.getByRole("textbox"), "-6");
    await userEvent.keyboard("{Enter}");
    expect(onSendChange).toHaveBeenCalledWith("dly", -6);
    await screen.getByRole("slider", { name: "Reverb" }).click();
    await userEvent.fill(screen.getByRole("textbox"), "-80");
    await userEvent.keyboard("{Enter}");
    expect(onSendChange).toHaveBeenLastCalledWith("verb", null);
  });

  test("a bus's own rack has no sends", async () => {
    const { screen } = renderRack({ channelType: undefined, instrument: undefined, buses });
    await expect.element(screen.getByRole("slider", { name: "Reverb" })).not.toBeInTheDocument();
  });

  test("Audio from and Audio to pick the track's input and output", async () => {
    const onInputChange = vi.fn();
    const onOutputChange = vi.fn();
    const inputOptions = [
      { value: "", label: "Audio interface" },
      { value: "gtr", label: "Guitar" },
    ];
    const outputOptions = [
      { value: "", label: "Master" },
      { value: "grp", label: "Group" },
    ];
    const { screen } = renderRack({ channelType: "audio", instrument: null, inputOptions, onInputChange, outputOptions, onOutputChange });
    const from = screen.getByText("Audio from").getByRole("combobox").first();
    await from.selectOptions("Guitar");
    expect(onInputChange).toHaveBeenCalledWith("gtr", "postFx");
    await screen.getByText("Audio to").getByRole("combobox").selectOptions("Group");
    expect(onOutputChange).toHaveBeenCalledWith("grp");
  });

  test("taking the input from a track, where on it can be chosen", async () => {
    const onInputChange = vi.fn();
    const inputOptions = [
      { value: "", label: "Audio interface" },
      { value: "gtr", label: "Guitar" },
    ];
    const { screen } = renderRack({ channelType: "audio", instrument: null, inputOptions, inputValue: "gtr", onInputChange });
    await screen.getByRole("combobox", { name: "Where on that track" }).selectOptions("Pre FX");
    expect(onInputChange).toHaveBeenCalledWith("gtr", "preFx");
  });
});
