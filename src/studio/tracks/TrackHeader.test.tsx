// A track's header on its own: what each control asks of the studio (the
// actions it's handed, each with the track's id), what it shows for each
// kind of track, and its meter reading the engine's levels.

import { beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "@vitest/browser/context";
import type { ComponentProps } from "react";
import { TrackHeader, type TrackHeaderActions } from "./TrackHeader";
import { TRACK_COLOR_PALETTE } from "@/project/colors";
import type { ChannelConfig } from "@/project/types";
import { FOLDED_ROW_HEIGHT } from "@/studio/timeline/layout";

const engine = vi.hoisted(() => ({ levels: [0, 0] as [number, number], input: null as number | null }));
vi.mock("@/engine/audioEngine", () => ({
  audioEngine: {
    getLevels: () => engine.levels,
    getMasterLevels: () => engine.levels,
    getInputPeak: () => engine.input,
  },
}));

beforeEach(() => {
  engine.levels = [0, 0];
  engine.input = null;
});

const ACTIONS = [
  "select", "rename", "setVolume", "setPan", "adjustStart", "toggleMute", "toggleSolo", "toggleArm",
  "toggleMonitor", "openFx", "importMidi", "exportMidi", "importAudio", "clear", "remove", "contextMenu",
  "recolor", "move", "toggleAutomation", "setInputDevice", "requestInputDevices", "toggleFold", "pick", "resizeHeight",
] as const satisfies readonly (keyof TrackHeaderActions)[];

type Actions = { [K in keyof TrackHeaderActions]: Mock<TrackHeaderActions[K]> };

function channel(overrides: Partial<ChannelConfig> = {}): ChannelConfig {
  return {
    id: "bass",
    name: "Bass",
    volume: 0,
    pan: 0,
    colorIndex: 0,
    type: "midi",
    instrument: "synth",
    muted: false,
    solo: false,
    armed: false,
    ...overrides,
  };
}

function renderHeader(props: Partial<ComponentProps<typeof TrackHeader>> = {}) {
  const actions = Object.fromEntries(ACTIONS.map((name) => [name, vi.fn()])) as unknown as Actions;
  const screen = render(
    <TrackHeader
      channel={channel()}
      color={TRACK_COLOR_PALETTE[0]}
      selected={false}
      recording={false}
      hasNotes
      canRemove
      canMoveUp
      canMoveDown
      actions={actions}
      {...props}
    />
  );
  return { screen, actions };
}

describe("a MIDI track", () => {
  test("each button asks for its action, for this track", async () => {
    const { screen, actions } = renderHeader();
    const click = (title: string | RegExp) => screen.getByTitle(title, { exact: true }).click();
    await click("Mute");
    expect(actions.toggleMute).toHaveBeenCalledWith("bass");
    await click("Solo");
    expect(actions.toggleSolo).toHaveBeenCalledWith("bass");
    await click("Arm this channel for recording and note input");
    expect(actions.toggleArm).toHaveBeenCalledWith("bass");
    await click("Export .mid");
    expect(actions.exportMidi).toHaveBeenCalledWith("bass");
    await click("Clear all clips on this track");
    expect(actions.clear).toHaveBeenCalledWith("bass");
    await click("Move track up");
    expect(actions.move).toHaveBeenCalledWith("bass", -1);
    await click("Move track down");
    expect(actions.move).toHaveBeenLastCalledWith("bass", 1);
    await click("Show automation lane");
    expect(actions.toggleAutomation).toHaveBeenCalledWith("bass");
    await click("Remove channel");
    expect(actions.remove).toHaveBeenCalledWith("bass");
    await screen.getByRole("button", { name: /FX/ }).click();
    expect(actions.openFx).toHaveBeenCalledWith("bass");
    // None of them selects the track as well.
    expect(actions.select).not.toHaveBeenCalled();
  });

  test("buttons with nothing to act on are off", async () => {
    const { screen } = renderHeader({ hasNotes: false, canMoveUp: false, canMoveDown: true, canRemove: false });
    await expect.element(screen.getByTitle("Export .mid")).toBeDisabled();
    await expect.element(screen.getByTitle("Clear all clips on this track")).toBeDisabled();
    await expect.element(screen.getByTitle("Move track up")).toBeDisabled();
    await expect.element(screen.getByTitle("Move track down")).toBeEnabled();
    await expect.element(screen.getByTitle("Remove channel")).not.toBeInTheDocument();
  });

  test("shows its state: muted, soloed, armed, the instrument and its effects", async () => {
    const { screen } = renderHeader({ channel: channel({ muted: true, solo: true, armed: true }), effectsCount: 3 });
    await expect.element(screen.getByTitle("Unmute", { exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect.element(screen.getByTitle("Unsolo", { exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect.element(screen.getByTitle("Record-armed - click to disarm")).toHaveAttribute("aria-pressed", "true");
    await expect.element(screen.getByTitle("MIDI track")).toHaveTextContent("Synth");
    await expect.element(screen.getByTitle("FX (3) — instrument & effects")).toHaveTextContent("3");
  });

  test("a click selects the track; Ctrl-click picks it for a group instead", async () => {
    const { screen, actions } = renderHeader();
    const header = screen.getByRole("group", { name: "Track Bass" });
    await header.click({ position: { x: 150, y: 4 } });
    expect(actions.select).toHaveBeenCalledWith("bass");
    await header.click({ position: { x: 150, y: 4 }, modifiers: ["Control"] });
    expect(actions.pick).toHaveBeenCalledWith("bass");
    expect(actions.select).toHaveBeenCalledOnce();
  });

  test("double-click the name to rename: Enter keeps it, Escape doesn't", async () => {
    const { screen, actions } = renderHeader();
    await screen.getByTitle("Double-click to rename").dblClick();
    await userEvent.fill(screen.getByRole("textbox"), "Sub Bass");
    await userEvent.keyboard("{Enter}");
    expect(actions.rename).toHaveBeenCalledWith("bass", "Sub Bass");

    await screen.getByTitle("Double-click to rename").dblClick();
    await userEvent.fill(screen.getByRole("textbox"), "Nope");
    await userEvent.keyboard("{Escape}");
    expect(actions.rename).toHaveBeenCalledOnce();
    await expect.element(screen.getByTitle("Double-click to rename")).toHaveTextContent("Bass");
  });

  test("the color dot opens the palette; a swatch recolors the track", async () => {
    const { screen, actions } = renderHeader();
    await screen.getByTitle("Change track color").click();
    await screen.getByTitle("Color 3", { exact: true }).click();
    expect(actions.recolor).toHaveBeenCalledWith("bass", { colorIndex: 2 });
    await expect.element(screen.getByTitle("Color 3", { exact: true })).not.toBeInTheDocument();
  });

  test("typing a volume and a pan sets them, each one undo step", async () => {
    const { screen, actions } = renderHeader();
    for (const [name, value] of [["Vol", "-6"], ["Pan", "-0.5"]] as const) {
      await screen.getByRole("slider", { name }).click();
      await userEvent.fill(screen.getByRole("textbox"), value);
      await userEvent.keyboard("{Enter}");
    }
    expect(actions.setVolume).toHaveBeenCalledWith("bass", -6);
    expect(actions.setPan).toHaveBeenCalledWith("bass", -0.5);
    expect(actions.adjustStart).toHaveBeenCalledTimes(2);
  });

  test("a .mid file chosen to import goes to the track", async () => {
    const { screen, actions } = renderHeader();
    const input = screen.container.querySelector<HTMLInputElement>('input[type="file"][accept*=".mid"]')!;
    const file = new File([new Uint8Array([0x4d, 0x54, 0x68, 0x64])], "riff.mid", { type: "audio/midi" });
    await userEvent.upload(input, file);
    expect(actions.importMidi).toHaveBeenCalledWith("bass", expect.objectContaining({ name: "riff.mid" }));
  });

  test("the meter shows the engine's left and right levels", async () => {
    const { screen } = renderHeader();
    engine.levels = [0.5, 0.25];
    const level = (side: string) =>
      screen.getByTitle(side, { exact: true }).element().firstElementChild!.getAttribute("style") ?? "";
    await expect.poll(() => level("Left")).toContain("inset(50% 0px 0px)");
    await expect.poll(() => level("Right")).toContain("inset(75% 0px 0px)");
  });
});

describe("other kinds of track", () => {
  test("an audio track: monitor, its input device, and an input meter when armed", async () => {
    const devices = [{ deviceId: "usb", label: "USB Interface" }];
    const { screen, actions } = renderHeader({
      channel: channel({ id: "gtr", name: "Guitar", type: "audio", instrument: null, armed: true }),
      inputDevices: devices,
    });
    await screen.getByTitle(/^Monitor - /).click();
    expect(actions.toggleMonitor).toHaveBeenCalledWith("gtr");

    // Going to the input list asks for the devices (whose names the browser
    // only gives once the microphone is allowed); picking one sets it.
    const input = screen.getByTitle(/^Which microphone/);
    (input.element() as HTMLSelectElement).focus();
    expect(actions.requestInputDevices).toHaveBeenCalled();
    await input.selectOptions("USB Interface");
    expect(actions.setInputDevice).toHaveBeenCalledWith("gtr", "usb");

    // Armed, it shows the input's level once the input is open; MIDI's
    // import/export are gone.
    await expect.element(screen.getByRole("img", { name: "Input level meter" })).toBeVisible();
    await expect.element(screen.getByTitle("Waiting for the input…")).toBeInTheDocument();
    engine.input = 0.5;
    await expect.element(screen.getByTitle(/^Input level: aim for peaks/)).toBeInTheDocument();
    await expect.element(screen.getByTitle("Export .mid")).not.toBeInTheDocument();
    await expect.element(screen.getByTitle("Import audio file")).toBeVisible();
  });

  test("a group: its track count, and no arm, import or clear", async () => {
    const { screen } = renderHeader({ channel: channel({ id: "g", name: "Drums", type: "group", instrument: null }), memberCount: 3 });
    await expect.element(screen.getByTitle("3 tracks in this group")).toBeVisible();
    await expect.element(screen.getByTitle("Arm this channel for recording and note input")).not.toBeInTheDocument();
    await expect.element(screen.getByTitle("Clear all clips on this track")).not.toBeInTheDocument();
    await expect.element(screen.getByTitle("Remove the group (its tracks stay)")).toBeVisible();
  });

  test("folded: only the name, mute and solo; Alt-click folds every track", async () => {
    const { screen, actions } = renderHeader({ channel: channel({ folded: true }), rowHeight: FOLDED_ROW_HEIGHT });
    await expect.element(screen.getByTitle("Mute", { exact: true })).toBeVisible();
    await expect.element(screen.getByRole("slider", { name: "Vol" })).not.toBeInTheDocument();
    await expect.element(screen.getByTitle("Export .mid")).not.toBeInTheDocument();
    await screen.getByTitle(/^Unfold/).click({ modifiers: ["Alt"] });
    expect(actions.toggleFold).toHaveBeenCalledWith("bass", true);
  });

  test("a shorter track shows the rows that fit: controls, then pan and volume, then its files", async () => {
    const short = renderHeader({ channel: channel({ height: 70 }), rowHeight: 70 });
    await expect.element(short.screen.getByTitle("Mute", { exact: true })).toBeVisible();
    await expect.element(short.screen.getByRole("slider", { name: "Vol" })).not.toBeInTheDocument();
    short.screen.unmount();
    const mid = renderHeader({ channel: channel({ height: 100 }), rowHeight: 100 });
    await expect.element(mid.screen.getByRole("slider", { name: "Vol" })).toBeVisible();
    await expect.element(mid.screen.getByTitle("Export .mid")).not.toBeInTheDocument();
    mid.screen.unmount();
    const tall = renderHeader({ channel: channel({ height: 200 }), rowHeight: 200 });
    await expect.element(tall.screen.getByTitle("Export .mid")).toBeVisible();
  });

  test("double-clicking its bottom edge gives it the standard height (Alt: every track); a folded one has none", async () => {
    const { screen, actions } = renderHeader({ channel: channel({ height: 200 }), rowHeight: 200 });
    await screen.getByRole("separator", { name: "Track height" }).dblClick();
    expect(actions.resizeHeight).toHaveBeenCalledWith("bass", null, false);
    await screen.getByRole("separator", { name: "Track height" }).dblClick({ modifiers: ["Alt"] });
    expect(actions.resizeHeight).toHaveBeenCalledWith("bass", null, true);
    expect(actions.select).not.toHaveBeenCalled();
    screen.unmount();
    const folded = renderHeader({ channel: channel({ folded: true }), rowHeight: FOLDED_ROW_HEIGHT });
    await expect.element(folded.screen.getByRole("separator", { name: "Track height" })).not.toBeInTheDocument();
  });

  test("the master: no color picker, no track buttons, and the master's meter", async () => {
    const { screen } = renderHeader({ channel: channel({ id: "master", name: "Master" }), isMaster: true });
    await expect.element(screen.getByTitle("Change track color")).not.toBeInTheDocument();
    await expect.element(screen.getByTitle("Mute", { exact: true })).not.toBeInTheDocument();
    engine.levels = [1, 1];
    await expect
      .poll(() => screen.getByTitle("Left", { exact: true }).element().firstElementChild!.getAttribute("style"))
      .toContain("inset(0% 0px 0px)");
  });
});

describe("an audio track's input device", () => {
  test("is its own: it shows the track's device, or Default", async () => {
    const devices = [{ deviceId: "usb", label: "USB Interface" }, { deviceId: "cam", label: "Webcam" }];
    const audio = (inputDevice?: string) => channel({ id: "gtr", name: "Guitar", type: "audio", instrument: null, ...(inputDevice ? { inputDevice } : {}) });
    // Two tracks: one on the interface, one on the default.
    renderHeader({ channel: audio("usb"), inputDevices: devices });
    const { screen } = renderHeader({ channel: audio(), inputDevices: devices });
    const inputs = screen.getByRole("combobox", { name: "Input" });
    await expect.element(inputs.nth(0)).toHaveValue("usb");
    await expect.element(inputs.nth(1)).toHaveValue("");
  });

  test("one that isn't plugged in says so, and stays picked", async () => {
    const { screen } = renderHeader({
      channel: channel({ id: "gtr", name: "Guitar", type: "audio", instrument: null, inputDevice: "gone" }),
      inputDevices: [{ deviceId: "usb", label: "USB Interface" }],
    });
    const input = screen.getByRole("combobox", { name: "Input" });
    await expect.element(input).toHaveValue("gone");
    await expect.element(input.getByRole("option", { name: "Not connected" })).toBeInTheDocument();
  });
});

describe("a silent track", () => {
  test("says why, beside its name", async () => {
    const detail = "Silent: another track is soloed. Solo this one too, or unsolo the others, to hear it.";
    const { screen } = renderHeader({ silent: { label: "Silent", detail } });
    await expect.element(screen.getByRole("status", { name: detail })).toHaveTextContent("Silent");
  });

  test("monitoring with no signal coming in says so after a few seconds, and stops once there is", async () => {
    engine.input = 0;
    const { screen } = renderHeader({ channel: channel({ type: "audio", instrument: null }), monitoring: true });
    const note = screen.getByRole("status", { name: /^Monitoring, but no signal/ });
    await expect.element(note, { timeout: 6000 }).toBeVisible();
    engine.input = 0.2;
    await expect.element(note, { timeout: 3000 }).not.toBeInTheDocument();
  });

  test("its FX button counts the bypassed effects", async () => {
    const { screen } = renderHeader({ channel: channel({ type: "audio", instrument: null }), effectsCount: 3, bypassedCount: 1 });
    await expect.element(screen.getByTitle("FX (3, 1 bypassed) — instrument & effects")).toBeVisible();
  });
});
