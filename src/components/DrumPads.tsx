"use client";

import { useEffect, useRef } from "react";
import { PAD_KEYS, PAD_KEY_ORDER, defaultKitPads, type DrumKitParams } from "@/lib/drumParams";
import { drumPads } from "@/lib/drums";
import { padColor } from "./DrumRackWindow";

interface DrumPadsProps {
  /** The armed track's kit (names and colors). */
  kit?: DrumKitParams;
  activeNotes: Set<string>;
  onNoteOn: (note: string, velocity: number) => void;
  onNoteOff: (note: string) => void;
  keyboardShortcutsEnabled?: boolean;
}

const HIT_DURATION_MS = 90;

/** The armed Drum Rack's 16 pads, laid out like the keys that play them:
 * A S D F G H J K L ; on top (kick, snare, clap, toms, hats, crash, ride)
 * and Q W E R T Y below. */
export function DrumPads({ kit, activeNotes, onNoteOn, onNoteOff, keyboardShortcutsEnabled = true }: DrumPadsProps) {
  const pressedKeys = useRef<Set<string>>(new Set());
  const pads = drumPads(kit);
  const params = kit?.pads ?? defaultKitPads();
  const noteOf = (pad: number) => pads[pad].note;

  const hit = (note: string) => {
    onNoteOn(note, 0.9);
    window.setTimeout(() => onNoteOff(note), HIT_DURATION_MS);
  };

  useEffect(() => {
    if (!keyboardShortcutsEnabled) return;
    const isTypingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd/Alt-held keys are chord shortcuts, never pad input.
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      const idx = PAD_KEYS.indexOf(key);
      if (idx === -1 || pressedKeys.current.has(key)) return;
      pressedKeys.current.add(key);
      hit(noteOf(PAD_KEY_ORDER[idx]));
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      pressedKeys.current.delete(e.key.toLowerCase());
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyboardShortcutsEnabled]);

  const pad = (i: number, key: string) => {
    const note = noteOf(i);
    const active = activeNotes.has(note);
    const color = padColor(params[i]);
    return (
      <button
        key={i}
        type="button"
        onPointerDown={() => hit(note)}
        title={`${pads[i].label} · ${note} (${key.toUpperCase()})`}
        className={`relative flex h-12 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md border text-[11px] font-medium transition-colors select-none ${
          active ? "bg-accent/25 text-accent" : "bg-surface-raised hover:bg-surface hover:text-accent"
        }`}
        style={{ borderColor: active ? color : undefined, opacity: params[i].mute ? 0.45 : 1 }}
      >
        <span className="absolute inset-x-0 top-0 h-0.5" style={{ background: color }} />
        <span className="max-w-full truncate px-1">{pads[i].label}</span>
        <span className="font-mono text-[9px] text-muted">{key.toUpperCase()}</span>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-muted">
        {kit?.kit ?? "Drum Rack"} — click a pad or play with A S D F G H J K L ; and Q W E R T Y
      </div>
      <div className="grid grid-cols-10 gap-1.5">{PAD_KEYS.slice(0, 10).map((k, j) => pad(PAD_KEY_ORDER[j], k))}</div>
      <div className="grid grid-cols-10 gap-1.5">{PAD_KEYS.slice(10).map((k, j) => pad(PAD_KEY_ORDER[10 + j], k))}</div>
    </div>
  );
}

