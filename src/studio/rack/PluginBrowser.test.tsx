// The browser's Plugins tab, with the desktop app's plugin commands stood
// in for: the plugins by kind and format, the search, the scan's progress
// as it goes, the files that couldn't be read, and the folders.

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "@vitest/browser/context";
import type { PluginInfo, PluginList } from "@/engine/native/bridge";

const bridge = vi.hoisted(() => ({
  list: vi.fn<() => Promise<PluginList>>(),
  scan: vi.fn<(retryFailed: boolean) => Promise<void>>(async () => {}),
  addFolder: vi.fn<(path: string) => Promise<void>>(async () => {}),
  removeFolder: vi.fn<(path: string) => Promise<void>>(async () => {}),
}));
vi.mock("@/engine/native/bridge", () => ({ pluginBridge: bridge }));

import { PluginBrowser } from "./PluginBrowser";
import { EffectBrowser } from "./EffectBrowser";
import { plugins } from "@/engine/native/plugins";

const plugin = (name: string, kind: PluginInfo["kind"], format: PluginInfo["format"] = "vst3", vendor = "Acme"): PluginInfo => ({
  format,
  id: `${format}.${name}`,
  name,
  vendor,
  version: "1.0",
  kind,
  categories: kind === "instrument" ? ["Instrument", "Synth"] : ["Fx", "Delay"],
  path: `/Library/Audio/Plug-Ins/${format.toUpperCase()}/${name}.${format}`,
});

const LIST: PluginList = {
  plugins: [plugin("Echoes", "effect"), plugin("Echoes", "effect", "clap"), plugin("Pads", "instrument", "vst3", "Cloud Synths"), plugin("Arp", "noteEffect", "clap")],
  failed: [{ format: "vst3", path: "/Library/Audio/Plug-Ins/VST3/Broken.vst3", error: "It crashed as it loaded." }],
  folders: [
    { path: "/Library/Audio/Plug-Ins/VST3", standard: true, exists: true },
    { path: "/Volumes/Sounds/Plugins", standard: false, exists: true },
  ],
  scan: null,
  scanned: true,
};

beforeEach(() => {
  Object.values(bridge).forEach((fn) => fn.mockClear());
  bridge.list.mockReset();
  bridge.list.mockResolvedValue(LIST);
});

async function renderTab() {
  await plugins.refresh();
  return render(
    <div className="flex h-[600px] w-48 flex-col">
      <PluginBrowser />
    </div>
  );
}

describe("the Plugins tab", () => {
  test("lists the plugins by kind, with their format, and finds them by name or maker", async () => {
    const screen = await renderTab();
    await expect.element(screen.getByText("4 plugins found")).toBeVisible();
    const items = (group: string) => [...screen.getByRole("list", { name: group, exact: true }).element().querySelectorAll("li")].map((li) => li.textContent);
    expect(items("Instruments")).toEqual(["PadsVST3"]);
    expect(items("Effects")).toEqual(["EchoesVST3", "EchoesCLAP"]);
    expect(items("Note effects")).toEqual(["ArpCLAP"]);

    await userEvent.fill(screen.getByRole("textbox", { name: "Search plugins" }), "cloud");
    await expect.element(screen.getByRole("list", { name: "Effects", exact: true })).not.toBeInTheDocument();
    expect(items("Instruments")).toEqual(["PadsVST3"]);
    await userEvent.fill(screen.getByRole("textbox", { name: "Search plugins" }), "zzz");
    await expect.element(screen.getByText("Nothing matches “zzz”.")).toBeVisible();
  });

  test("shows how the scan is going, and the list when it's done", async () => {
    // Read again as the scan goes, until it's done.
    let done = false;
    bridge.list.mockImplementation(async () =>
      done ? LIST : { ...LIST, plugins: [], scan: { done: 3, total: 8, reading: ["C:\\Program Files\\Common Files\\VST3\\Big Synth.vst3"] }, scanned: false }
    );
    const screen = await renderTab();
    await expect.element(screen.getByText("Looking for plugins: 3 of 8 · Big Synth.vst3")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Rescan plugins" })).toBeDisabled();
    done = true;
    await expect.element(screen.getByText("4 plugins found")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Rescan plugins" }));
    expect(bridge.scan).toHaveBeenCalledWith(false);
  });

  test("says which files couldn't be read and why, and tries them again", async () => {
    const screen = await renderTab();
    await userEvent.click(screen.getByRole("button", { name: "1 couldn't be read" }));
    const failed = screen.getByRole("list", { name: "Plugins that couldn't be read" });
    await expect.element(failed).toHaveTextContent("Broken.vst3It crashed as it loaded.");
    await userEvent.click(screen.getByRole("button", { name: "Try them again" }));
    expect(bridge.scan).toHaveBeenCalledWith(true);
  });

  test("lists the folders it looks in, and takes more", async () => {
    const screen = await renderTab();
    await userEvent.click(screen.getByRole("button", { name: "Folders" }));
    await expect.element(screen.getByText("/Library/Audio/Plug-Ins/VST3")).toBeVisible();
    // Only the folders the user added can be taken off.
    expect(screen.getByRole("button", { name: "Stop looking in /Library/Audio/Plug-Ins/VST3" }).query()).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Stop looking in /Volumes/Sounds/Plugins" }));
    expect(bridge.removeFolder).toHaveBeenCalledWith("/Volumes/Sounds/Plugins");

    await userEvent.fill(screen.getByRole("textbox", { name: "Folder to add" }), "/Users/ana/Plugins");
    await userEvent.click(screen.getByRole("button", { name: "Add folder" }));
    expect(bridge.addFolder).toHaveBeenCalledWith("/Users/ana/Plugins");
    await expect.element(screen.getByRole("textbox", { name: "Folder to add" })).toHaveValue("");

    bridge.addFolder.mockRejectedValueOnce("There's no folder there.");
    await userEvent.fill(screen.getByRole("textbox", { name: "Folder to add" }), "/nope");
    await userEvent.keyboard("{Enter}");
    await expect.element(screen.getByText("There's no folder there.")).toBeVisible();
  });

  test("says when it found nothing", async () => {
    bridge.list.mockResolvedValue({ ...LIST, plugins: [], failed: [] });
    const screen = await renderTab();
    await expect.element(screen.getByText(/No VST3 or CLAP plugins were found/)).toBeVisible();
  });

  test("is a tab of the browser in the desktop app", async () => {
    await plugins.refresh();
    const screen = render(
      <div className="flex h-[600px]">
        <EffectBrowser onAddEffect={() => {}} plugins={<PluginBrowser />} />
      </div>
    );
    const tabs = screen.getByRole("tab");
    expect(tabs.elements().map((t) => t.textContent)).toEqual(["Effects", "Grooves", "Plugins"]);
    // The three labels fit side by side.
    for (const tab of tabs.elements()) expect(tab.scrollWidth).toBeLessThanOrEqual(tab.clientWidth);
    await userEvent.click(screen.getByRole("tab", { name: "Plugins" }));
    await expect.element(screen.getByText("4 plugins found")).toBeVisible();
  });
});
