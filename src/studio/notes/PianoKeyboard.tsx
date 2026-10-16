"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import {
  KEYBOARD_HIGH_MIDI,
  KEYBOARD_KEY_OFFSETS,
  KEYBOARD_LOW_MIDI,
  isBlackKey,
  midiToNoteName,
} from "@/instruments/piano/piano";
import { keyName, keyOf, readChord, type ChordReading } from "@/project/chords";
import { isNoteInScale, type ScaleSetting } from "@/project/scales";
import { useShortcuts } from "@/ui/shortcuts";

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

  // The note keys sit above the studio's shortcuts: while they play notes,
  // a letter is a note (R is F; Shift+R still records).
  useShortcuts("notes", [], {
    enabled: keyboardShortcutsEnabled,
    onKeyDown: (e, typing) => {
      // Held modifiers make a shortcut (Ctrl+C, Shift+R), never a note -
      // even though e.g. "c" is also a note key.
      if (typing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
      const key = e.key.toLowerCase();
      const offset = KEYBOARD_KEY_OFFSETS[key];
      if (offset === undefined) return false;
      if (e.repeat || pressedKeys.current.has(key)) return true;
      pressedKeys.current.add(key);
      onNoteOn(midiToNoteName(KEYBOARD_LOW_MIDI + octaveShift * 12 + offset), 0.85);
      return true;
    },
    onKeyUp: (e) => {
      const key = e.key.toLowerCase();
      const offset = KEYBOARD_KEY_OFFSETS[key];
      if (offset === undefined || !pressedKeys.current.has(key)) return;
      pressedKeys.current.delete(key);
      onNoteOff(midiToNoteName(KEYBOARD_LOW_MIDI + octaveShift * 12 + offset));
    },
  });

  /** Lets go of every key the computer keyboard is holding, as the notes
   * they played at octave `shift`. */
  const releaseHeldKeys = useEffectEvent((shift: number) => {
    const keys = pressedKeys.current;
    keys.forEach((key) => {
      const offset = KEYBOARD_KEY_OFFSETS[key];
      if (offset !== undefined) {
        onNoteOff(midiToNoteName(KEYBOARD_LOW_MIDI + shift * 12 + offset));
      }
    });
    keys.clear();
  });

  // Releases any keys the computer keyboard was holding when the octave shifts,
  // so notes don't get stuck on if the note name changes mid-hold. (The
  // notes were played at the octave before the shift.)
  useEffect(() => () => releaseHeldKeys(octaveShift), [octaveShift]);

  // Also release any held keys the moment shortcuts get suspended (e.g. the
  // piano roll editor opens), so a note can't get stuck on in the background.
  useEffect(() => {
    if (!keyboardShortcutsEnabled) releaseHeldKeys(octaveShift);
  }, [keyboardShortcutsEnabled, octaveShift]);

  // What the held notes make, named in the scale's key (E Major while no
  // scale is picked) - whatever's playing them, a MIDI keyboard too.
  const key = useMemo(() => keyOf(scaleSetting), [scaleSetting]);
  const chord = useMemo(() => {
    const held: number[] = [];
    for (let m = 0; m < 128; m++) if (activeNotes.has(midiToNoteName(m))) held.push(m);
    return readChord(held, key);
  }, [activeNotes, key]);

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
      <div className="flex items-center gap-2 whitespace-nowrap text-xs text-muted">
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
        <span className="min-w-0 truncate text-muted/70">
          play with Z…M / Q…P, an external MIDI keyboard, or click the keys
        </span>
        <ChordReadout chord={chord} keyLabel={keyName(key)} picked={scaleSetting.enabled} />
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

/** The chord being played: its name, its degree in the key, and whether
 * it's in the key. */
function ChordReadout({ chord, keyLabel, picked }: { chord: ChordReading | null; keyLabel: string; picked: boolean }) {
  const title = picked
    ? `Chords are named in ${keyLabel}, the scale picked in the toolbar`
    : `Chords are named in ${keyLabel} until you pick a scale (Scale, in the toolbar)`;
  return (
    // A fixed width, so the row doesn't shift as chords come and go.
    <div data-testid="chord-readout" aria-live="polite" title={title} className="ml-auto flex w-80 shrink-0 items-baseline justify-end gap-2">
      {chord ? (
        <>
          <span data-chord-name className="shrink-0 font-mono text-sm font-semibold text-foreground" title={chord.notes.join(" ")}>
            {chord.name ?? chord.notes.join(" ")}
          </span>
          {chord.degree && (
            <span data-chord-degree className="shrink-0 font-mono text-accent">
              {chord.degree}
            </span>
          )}
          {chord.quality && <span className="min-w-0 truncate text-muted/80">{chord.quality}</span>}
          <span className={`shrink-0 ${chord.inKey ? "text-muted" : "text-[#E6AD5E]"}`}>{chord.inKey ? `in ${keyLabel}` : `outside ${keyLabel}`}</span>
        </>
      ) : (
        <span className="text-muted/70">Chords in {keyLabel}</span>
      )}
    </div>
  );
}
