"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  KEYBOARD_HIGH_MIDI,
  KEYBOARD_KEY_OFFSETS,
  KEYBOARD_LOW_MIDI,
  isBlackKey,
  midiToNoteName,
} from "@/lib/piano";
import { isNoteInScale, type ScaleSetting } from "@/lib/scales";

interface PianoKeyboardProps {
  activeNotes: Set<string>;
  onNoteOn: (note: string, velocity: number) => void;
  onNoteOff: (note: string) => void;
  scaleSetting: ScaleSetting;
  /** Disables computer-keyboard shortcuts, e.g. while a modal with its own
   * shortcuts (like the piano roll editor's 'b' mode toggle) is open. */
  keyboardShortcutsEnabled?: boolean;
}

const PITCHES_WITH_BLACK_AFTER = new Set(["C", "D", "F", "G", "A"]);
const MIN_OCTAVE_SHIFT = -2;
const MAX_OCTAVE_SHIFT = 2;

function pitchClass(midi: number): string {
  return midiToNoteName(midi).replace(/-?\d+$/, "");
}

function buildKeyLayout(low: number, high: number) {
  const whiteMidis: number[] = [];
  for (let m = low; m <= high; m++) {
    if (!isBlackKey(m)) whiteMidis.push(m);
  }
  const whiteWidth = 100 / whiteMidis.length;
  const blackWidth = whiteWidth * 0.62;
  const blackKeys: { midi: number; left: number }[] = [];
  whiteMidis.forEach((w, i) => {
    if (PITCHES_WITH_BLACK_AFTER.has(pitchClass(w)) && w + 1 <= high) {
      blackKeys.push({ midi: w + 1, left: (i + 1) * whiteWidth - blackWidth / 2 });
    }
  });
  return { whiteMidis, whiteWidth, blackWidth, blackKeys };
}

export function PianoKeyboard({
  activeNotes,
  onNoteOn,
  onNoteOff,
  scaleSetting,
  keyboardShortcutsEnabled = true,
}: PianoKeyboardProps) {
  const [octaveShift, setOctaveShift] = useState(0);
  const pressedKeys = useRef<Set<string>>(new Set());
  const pressedMouseNote = useRef<string | null>(null);

  const { whiteMidis, whiteWidth, blackWidth, blackKeys } = useMemo(
    () => buildKeyLayout(KEYBOARD_LOW_MIDI, KEYBOARD_HIGH_MIDI),
    []
  );

  useEffect(() => {
    if (!keyboardShortcutsEnabled) return;

    const isTypingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      const offset = KEYBOARD_KEY_OFFSETS[key];
      if (offset === undefined || pressedKeys.current.has(key)) return;
      pressedKeys.current.add(key);
      const note = midiToNoteName(KEYBOARD_LOW_MIDI + octaveShift * 12 + offset);
      onNoteOn(note, 0.85);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const offset = KEYBOARD_KEY_OFFSETS[key];
      if (offset === undefined || !pressedKeys.current.has(key)) return;
      pressedKeys.current.delete(key);
      const note = midiToNoteName(KEYBOARD_LOW_MIDI + octaveShift * 12 + offset);
      onNoteOff(note);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [octaveShift, onNoteOn, onNoteOff, keyboardShortcutsEnabled]);

  // Releases any keys the computer keyboard was holding when the octave shifts,
  // so notes don't get stuck on if the note name changes mid-hold.
  useEffect(() => {
    const keys = pressedKeys.current;
    return () => {
      keys.forEach((key) => {
        const offset = KEYBOARD_KEY_OFFSETS[key];
        if (offset !== undefined) {
          onNoteOff(midiToNoteName(KEYBOARD_LOW_MIDI + octaveShift * 12 + offset));
        }
      });
      keys.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [octaveShift]);

  // Also release any held keys the moment shortcuts get suspended (e.g. the
  // piano roll editor opens), so a note can't get stuck on in the background.
  useEffect(() => {
    if (keyboardShortcutsEnabled) return;
    const keys = pressedKeys.current;
    keys.forEach((key) => {
      const offset = KEYBOARD_KEY_OFFSETS[key];
      if (offset !== undefined) {
        onNoteOff(midiToNoteName(KEYBOARD_LOW_MIDI + octaveShift * 12 + offset));
      }
    });
    keys.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyboardShortcutsEnabled]);

  const handleMouseDown = (note: string) => {
    pressedMouseNote.current = note;
    onNoteOn(note, 0.9);
  };

  const releaseMouse = () => {
    if (pressedMouseNote.current) {
      onNoteOff(pressedMouseNote.current);
      pressedMouseNote.current = null;
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span>Computer keyboard octave</span>
        <button
          type="button"
          disabled={octaveShift <= MIN_OCTAVE_SHIFT}
          onClick={() => setOctaveShift((o) => Math.max(MIN_OCTAVE_SHIFT, o - 1))}
          className="rounded border border-border px-2 py-0.5 hover:bg-surface-raised disabled:opacity-30"
        >
          −
        </button>
        <span className="font-mono">{octaveShift}</span>
        <button
          type="button"
          disabled={octaveShift >= MAX_OCTAVE_SHIFT}
          onClick={() => setOctaveShift((o) => Math.min(MAX_OCTAVE_SHIFT, o + 1))}
          className="rounded border border-border px-2 py-0.5 hover:bg-surface-raised disabled:opacity-30"
        >
          +
        </button>
        <span className="text-muted/70">
          play with Z…M / Q…P, an external MIDI keyboard, or click the keys
        </span>
      </div>
      <div
        className="relative h-36 w-full touch-none select-none"
        onPointerUp={releaseMouse}
        onPointerLeave={releaseMouse}
      >
        {whiteMidis.map((m, i) => {
          const note = midiToNoteName(m);
          const active = activeNotes.has(note);
          const inScale = scaleSetting.enabled && isNoteInScale(m, scaleSetting);
          return (
            <div
              key={m}
              onPointerDown={() => handleMouseDown(note)}
              style={{ left: `${i * whiteWidth}%`, width: `${whiteWidth}%` }}
              className={`absolute top-0 h-full rounded-b-md border border-border/80 shadow-sm transition-colors ${
                active
                  ? "bg-accent"
                  : inScale
                    ? "bg-[#cfe6ff] hover:bg-white"
                    : "bg-[#e9e9ec] hover:bg-white"
              }`}
            />
          );
        })}
        {blackKeys.map(({ midi: m, left }) => {
          const note = midiToNoteName(m);
          const active = activeNotes.has(note);
          const inScale = scaleSetting.enabled && isNoteInScale(m, scaleSetting);
          return (
            <div
              key={m}
              onPointerDown={(e) => {
                e.stopPropagation();
                handleMouseDown(note);
              }}
              style={{ left: `${left}%`, width: `${blackWidth}%` }}
              className={`absolute top-0 z-10 h-[60%] rounded-b-md border border-black shadow-md transition-colors ${
                active
                  ? "bg-accent"
                  : inScale
                    ? "bg-[#1d3a5c] hover:bg-[#264a70]"
                    : "bg-[#0d0d10] hover:bg-[#1c1c22]"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
