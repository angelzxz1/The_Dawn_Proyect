import { describe, expect, it } from "vitest";
import { matches, ShortcutRegistry, type Shortcut, type ShortcutLayer, type ShortcutOptions } from "./shortcuts";

function key(k: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {}, target: unknown = null) {
  let prevented = false;
  const e = {
    key: k,
    code: k === " " ? "Space" : `Key${k.toUpperCase()}`,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    target,
    ...mods,
    preventDefault: () => {
      prevented = true;
    },
  };
  return { e: e as unknown as KeyboardEvent, prevented: () => prevented };
}

function registry() {
  const r = new ShortcutRegistry();
  const log: string[] = [];
  const add = (layer: ShortcutLayer, list: Shortcut[], options: ShortcutOptions = {}) =>
    r.add(
      layer,
      () => list,
      () => options
    );
  return { r, log, add };
}

describe("matches", () => {
  it("needs the modifiers exactly", () => {
    expect(matches(key("z", { ctrlKey: true }).e, "mod+z")).toBe(true);
    expect(matches(key("z", { metaKey: true }).e, "mod+z")).toBe(true);
    expect(matches(key("Z", { ctrlKey: true, shiftKey: true }).e, "mod+z")).toBe(false);
    expect(matches(key("Z", { ctrlKey: true, shiftKey: true }).e, "mod+shift+z")).toBe(true);
    expect(matches(key("r").e, "shift+r")).toBe(false);
    expect(matches(key(" ").e, "space")).toBe(true);
    expect(matches(key("Backspace").e, "delete")).toBe(true);
    expect(matches(key("ArrowLeft", { metaKey: true }).e, "mod+arrowleft")).toBe(true);
  });
});

describe("ShortcutRegistry", () => {
  it("gives a key to the top layer only", () => {
    const { r, log, add } = registry();
    add("studio", [{ keys: "escape", run: () => void log.push("studio") }]);
    add("menu", [{ keys: "escape", run: () => void log.push("menu"), whileTyping: true }]);
    add("window", [{ keys: "escape", run: () => void log.push("window") }]);
    const { e, prevented } = key("Escape");
    expect(r.keyDown(e)).toBe(true);
    expect(log).toEqual(["menu"]);
    expect(prevented()).toBe(true);
  });

  it("passes a key down when a shortcut had nothing to do", () => {
    const { r, log, add } = registry();
    add("studio", [{ keys: "escape", run: () => void log.push("studio") }]);
    add("window", [{ keys: "escape", run: () => false }]);
    const { e, prevented } = key("Escape");
    r.keyDown(e);
    expect(log).toEqual(["studio"]);
    expect(prevented()).toBe(true);
  });

  it("keeps keys from the studio while a modal layer is open", () => {
    const { r, log, add } = registry();
    add("studio", [{ keys: "space", run: () => void log.push("play") }]);
    const close = add("dialog", [{ keys: "escape", run: () => void log.push("close"), whileTyping: true }]);
    expect(r.keyDown(key(" ").e)).toBe(false);
    expect(log).toEqual([]);
    close();
    r.keyDown(key(" ").e);
    expect(log).toEqual(["play"]);
  });

  it("lets Save through a dialog, but not through the tour", () => {
    const { r, log, add } = registry();
    add("global", [{ keys: "mod+s", run: () => void log.push("save"), whileTyping: true }]);
    add("dialog", []);
    r.keyDown(key("s", { ctrlKey: true }).e);
    expect(log).toEqual(["save"]);
    add("overlay", [], { onKeyDown: () => true });
    r.keyDown(key("s", { ctrlKey: true }).e);
    expect(log).toEqual(["save"]);
  });

  it("skips shortcuts while typing unless they work there", () => {
    const { r, log, add } = registry();
    const input = { tagName: "INPUT" };
    add("studio", [{ keys: "space", run: () => void log.push("play") }]);
    add("global", [{ keys: "mod+s", run: () => void log.push("save"), whileTyping: true }]);
    r.keyDown(key(" ", {}, input).e);
    r.keyDown(key("s", { ctrlKey: true }, input).e);
    expect(log).toEqual(["save"]);
  });

  it("note keys take letters before the studio, Shift+R still records", () => {
    const { r, log, add } = registry();
    add("studio", [{ keys: ["r", "shift+r"], run: () => void log.push("record") }]);
    const notes = add("notes", [], {
      onKeyDown: (e) => {
        if (e.shiftKey || e.key !== "r") return false;
        log.push("note F");
        return true;
      },
    });
    r.keyDown(key("r").e);
    r.keyDown(key("R", { shiftKey: true }).e);
    notes();
    r.keyDown(key("r").e);
    expect(log).toEqual(["note F", "record", "record"]);
  });

  it("an off layer takes nothing and doesn't block", () => {
    const { r, log, add } = registry();
    add("studio", [{ keys: "space", run: () => void log.push("play") }]);
    add("editor", [{ keys: "space", run: () => void log.push("editor") }], { enabled: false });
    r.keyDown(key(" ").e);
    expect(log).toEqual(["play"]);
  });

  it("releases keys in every layer", () => {
    const { r, log, add } = registry();
    add("notes", [], { onKeyUp: () => void log.push("notes up") });
    add("dialog", [], { onKeyUp: () => void log.push("dialog up") });
    r.keyUp(key("a").e);
    expect(log.sort()).toEqual(["dialog up", "notes up"]);
  });

  it("lists the labeled shortcuts that work now", () => {
    const { r, add } = registry();
    add("studio", [{ keys: "space", label: "Play / pause", run: () => {} }]);
    add("editor", [{ keys: "b", label: "Draw / Select", run: () => {} }]);
    expect(r.active().map((s) => s.label)).toEqual(["Draw / Select"]);
  });
});
