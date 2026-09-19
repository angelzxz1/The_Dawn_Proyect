"use client";

import { useEffect, useRef } from "react";
import { DRUM_PADS } from "@/lib/drums";

interface DrumPadsProps {
  activeNotes: Set<string>;
  onNoteOn: (note: string, velocity: number) => void;
  onNoteOff: (note: string) => void;
  keyboardShortcutsEnabled?: boolean;
}

// One QWERTY row maps straight onto the pads, Ableton Drum-Rack style -
// press a key for a quick hit instead of having to click.
const PAD_KEYS = ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";"];
const HIT_DURATION_MS = 90;

export function DrumPads({
  activeNotes,
  onNoteOn,
  onNoteOff,
  keyboardShortcutsEnabled = true,
}: DrumPadsProps) {
  const pressedKeys = useRef<Set<string>>(new Set());

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
      if (idx === -1 || idx >= DRUM_PADS.length || pressedKeys.current.has(key)) return;
      pressedKeys.current.add(key);
      hit(DRUM_PADS[idx].note);
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

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-muted">
        drum rack — click a pad or play with A S D F G H J K L ;
      </div>
      <div className="grid grid-cols-5 gap-2">
        {DRUM_PADS.map((pad, i) => {
          const active = activeNotes.has(pad.note);
          return (
            <button
              key={pad.note}
              type="button"
              onPointerDown={() => hit(pad.note)}
              title={`${pad.label} (${PAD_KEYS[i]?.toUpperCase()})`}
              className={`flex h-14 flex-col items-center justify-center gap-0.5 rounded-md border text-[11px] font-medium transition-colors select-none ${
                active
                  ? "border-accent bg-accent/25 text-accent"
                  : "border-border bg-surface-raised hover:bg-surface hover:text-accent"
              }`}
            >
              <span>{pad.label}</span>
              <span className="font-mono text-[9px] text-muted">{PAD_KEYS[i]?.toUpperCase()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
