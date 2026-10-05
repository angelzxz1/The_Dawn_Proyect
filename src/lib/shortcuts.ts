// Every keyboard shortcut in the app goes through here: one listener on the
// window, and layers that take keys in order. A layer higher up (a menu, a
// dialog) gets a key before the ones below it (the studio), and a modal
// layer (a dialog, the piano roll, the tour) keeps keys from the layers
// below it altogether. So Escape closes just the topmost thing, Space
// doesn't start playback behind a dialog, and one check decides whether
// you're typing in a field.

import { useEffect, useRef } from "react";

/** From the bottom up. */
export type ShortcutLayer =
  /** The studio: transport, clips, tracks, loop. */
  | "studio"
  /** Playing notes and pads from the computer keyboard. */
  | "notes"
  /** The piano roll (modal: the studio and note keys wait). */
  | "editor"
  /** Plugin, synth and drum rack windows. */
  | "window"
  /** Dialogs: export, start screen, about, packs (modal). */
  | "dialog"
  /** Popup menus. */
  | "menu"
  /** What works anywhere a dialog may be open: Save, Open. */
  | "global"
  /** The tour (modal: it takes every key). */
  | "overlay";

const ORDER: ShortcutLayer[] = ["studio", "notes", "editor", "window", "dialog", "menu", "global", "overlay"];
const MODAL = new Set<ShortcutLayer>(["editor", "dialog", "overlay"]);

export interface Shortcut {
  /** "space", "escape", "delete", "r", "shift+r", "mod+z" (Ctrl, or Cmd on a
   * Mac), "mod+shift+z", "alt+arrowleft"... Modifiers must match exactly. */
  keys: string | string[];
  /** Return false when there was nothing to do: the key goes on to the
   * layers below. Otherwise its default action is prevented. */
  run: (e: KeyboardEvent) => void | boolean;
  /** Also while typing in a text field or a dropdown (default: no). */
  whileTyping?: boolean;
  /** What it does, for a list of shortcuts. */
  label?: string;
}

export interface ShortcutOptions {
  /** Off: the layer takes no keys (default on). */
  enabled?: boolean;
  /** Keys that aren't a fixed list (notes, pads). Return true when
   * handled. Gets keys after the layer's shortcuts didn't match. */
  onKeyDown?: (e: KeyboardEvent, typing: boolean) => boolean | void;
  /** Every key release, in every layer (so a held note always ends). */
  onKeyUp?: (e: KeyboardEvent) => void;
}

interface Registration {
  layer: ShortcutLayer;
  seq: number;
  shortcuts: () => Shortcut[];
  options: () => ShortcutOptions;
}

/** Whether a key went to a text field or a dropdown. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable === true;
}

interface Combo {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

function parse(keys: string): Combo {
  const parts = keys.toLowerCase().split("+");
  // "mod++" would be the plus key; nothing uses it.
  const key = parts.pop()!;
  return { key, mod: parts.includes("mod"), shift: parts.includes("shift"), alt: parts.includes("alt") };
}

/** Whether a key press is `keys`. */
export function matches(e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">, keys: string): boolean {
  const c = parse(keys);
  if (c.mod !== (e.ctrlKey || e.metaKey) || c.shift !== e.shiftKey || c.alt !== e.altKey) return false;
  if (c.key === "space") return e.code === "Space";
  if (c.key === "delete") return e.key === "Delete" || e.key === "Backspace";
  return e.key.toLowerCase() === c.key;
}

export class ShortcutRegistry {
  private registrations: Registration[] = [];
  private seq = 0;
  private listening = false;

  add(layer: ShortcutLayer, shortcuts: () => Shortcut[], options: () => ShortcutOptions): () => void {
    const reg: Registration = { layer, seq: ++this.seq, shortcuts, options };
    this.registrations.push(reg);
    this.listen();
    return () => {
      this.registrations = this.registrations.filter((r) => r !== reg);
    };
  }

  /** Top first: higher layers, and in a layer the latest opened. */
  private ordered(): Registration[] {
    return [...this.registrations].sort((a, b) => ORDER.indexOf(b.layer) - ORDER.indexOf(a.layer) || b.seq - a.seq);
  }

  /** Hands a key press to the layers, top down. Returns whether a shortcut
   * took it. */
  keyDown(e: KeyboardEvent): boolean {
    const typing = isTypingTarget(e.target);
    for (const reg of this.ordered()) {
      const options = reg.options();
      if (options.enabled === false) continue;
      for (const shortcut of reg.shortcuts()) {
        if (typing && !shortcut.whileTyping) continue;
        const keys = Array.isArray(shortcut.keys) ? shortcut.keys : [shortcut.keys];
        if (!keys.some((k) => matches(e, k))) continue;
        if (shortcut.run(e) === false) continue;
        e.preventDefault();
        return true;
      }
      if (options.onKeyDown?.(e, typing) === true) return true;
      if (MODAL.has(reg.layer)) return false;
    }
    return false;
  }

  keyUp(e: KeyboardEvent): void {
    this.ordered().forEach((reg) => reg.options().onKeyUp?.(e));
  }

  /** The labeled shortcuts that work right now, top layer first. */
  active(): { keys: string[]; label: string; layer: ShortcutLayer }[] {
    const out: { keys: string[]; label: string; layer: ShortcutLayer }[] = [];
    for (const reg of this.ordered()) {
      if (reg.options().enabled === false) continue;
      reg.shortcuts().forEach((s) => {
        if (s.label) out.push({ keys: Array.isArray(s.keys) ? s.keys : [s.keys], label: s.label, layer: reg.layer });
      });
      if (MODAL.has(reg.layer)) break;
    }
    return out;
  }

  private listen(): void {
    if (this.listening || typeof window === "undefined") return;
    this.listening = true;
    // Bubbling, so a focused control (a knob's arrows, a field's Escape)
    // has the key first.
    window.addEventListener("keydown", (e) => this.keyDown(e));
    window.addEventListener("keyup", (e) => this.keyUp(e));
  }
}

export const shortcuts = new ShortcutRegistry();

/** Gives a component's shortcuts to a layer while it's mounted. The latest
 * `list` and `options` are used each time a key comes in, so handlers never
 * see stale values. */
export function useShortcuts(layer: ShortcutLayer, list: Shortcut[], options: ShortcutOptions = {}): void {
  const latest = useRef({ list, options });
  useEffect(() => {
    latest.current = { list, options };
  });
  useEffect(
    () =>
      shortcuts.add(
        layer,
        () => latest.current.list,
        () => latest.current.options
      ),
    [layer]
  );
}
