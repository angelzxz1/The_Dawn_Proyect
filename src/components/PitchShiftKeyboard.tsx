"use client";

import { isBlackKey } from "@/lib/piano";
import { PITCH_REFERENCE_MIDI, intervalLabel, splitShift } from "@/lib/pitchInterval";

interface PitchShiftKeyboardProps {
  pitch: number;
  fine: number;
}

const LOW = 36; // C2
const HIGH = 84; // C6
const WIDTH = 840;
const HEIGHT = 150;
const KEYS_TOP = 42;
const KEYS_BOTTOM = HEIGHT - 12;
const X0 = 18;
const X1 = WIDTH - 18;

interface KeyGeometry {
  midi: number;
  black: boolean;
  x: number;
  width: number;
  center: number;
}

const whiteCount = Array.from({ length: HIGH - LOW + 1 }, (_, i) => LOW + i).filter((m) => !isBlackKey(m)).length;
const WHITE_W = (X1 - X0) / whiteCount;
const BLACK_W = WHITE_W * 0.58;

const KEYS: KeyGeometry[] = (() => {
  const keys: KeyGeometry[] = [];
  let whiteIndex = 0;
  for (let midi = LOW; midi <= HIGH; midi++) {
    if (isBlackKey(midi)) {
      const x = X0 + whiteIndex * WHITE_W - BLACK_W / 2;
      keys.push({ midi, black: true, x, width: BLACK_W, center: x + BLACK_W / 2 });
    } else {
      const x = X0 + whiteIndex * WHITE_W;
      keys.push({ midi, black: false, x, width: WHITE_W, center: x + WHITE_W / 2 });
      whiteIndex++;
    }
  }
  return keys;
})();

/** Horizontal position of a (possibly fractional) note, interpolating
 * between neighbouring key centres so Fine moves the marker smoothly. */
function xForNote(note: number): number {
  const clamped = Math.max(LOW, Math.min(HIGH, note));
  const lo = Math.floor(clamped);
  const hi = Math.min(HIGH, lo + 1);
  const a = KEYS[lo - LOW].center;
  const b = KEYS[hi - LOW].center;
  return a + (b - a) * (clamped - lo);
}

/** A C2-C6 keyboard: the key the shift lands on (from C4) lit up, a marker
 * at the exact pitch including Fine, and the interval named above it. */
export function PitchShiftKeyboard({ pitch, fine }: PitchShiftKeyboardProps) {
  const { semitones } = splitShift(pitch, fine);
  const target = PITCH_REFERENCE_MIDI + semitones;
  const markerX = xForNote(PITCH_REFERENCE_MIDI + Math.round(pitch) + Math.round(fine) / 100);
  const litKey = KEYS.find((k) => k.midi === target);
  const whites = KEYS.filter((k) => !k.black);
  const blacks = KEYS.filter((k) => k.black);
  const blackBottom = KEYS_TOP + (KEYS_BOTTOM - KEYS_TOP) * 0.6;

  return (
    <div style={{ background: "#14151A", border: "1px solid #2E2F37", borderRadius: 10, overflow: "hidden", position: "relative" }}>
      <div
        // Kept on the far side from the marker so it never covers it.
        className={`absolute ${markerX < WIDTH * 0.5 ? "right-4" : "left-4"} top-3 rounded px-2 py-0.5 font-mono text-[12px]`}
        style={{ background: "#1B1C22", border: "1px solid #2E2F37", color: "#D9D4CC" }}
      >
        {intervalLabel(semitones)}
      </div>
      <svg
        width="100%"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        fill="none"
        role="img"
        aria-label={`Shift ${intervalLabel(semitones)}`}
        style={{ display: "block" }}
      >
        {whites.map((k) => (
          <rect
            key={k.midi}
            x={k.x + 1}
            y={KEYS_TOP}
            width={k.width - 2}
            height={KEYS_BOTTOM - KEYS_TOP}
            rx={2}
            fill={k.midi === target ? "#E6AD5E" : k.midi === PITCH_REFERENCE_MIDI ? "#3A3B44" : "#2A2B31"}
          />
        ))}
        {blacks.map((k) => (
          <rect
            key={k.midi}
            x={k.x}
            y={KEYS_TOP}
            width={k.width}
            height={blackBottom - KEYS_TOP}
            rx={2}
            fill={k.midi === target ? "#E6AD5E" : "#16171B"}
          />
        ))}
        {litKey && (
          <line
            x1={markerX}
            y1={KEYS_TOP - 8}
            x2={markerX}
            y2={KEYS_TOP}
            stroke="#E6AD5E"
            strokeWidth={2}
          />
        )}
        <circle cx={markerX} cy={KEYS_TOP - 10} r={5} fill="#E6AD5E" />
      </svg>
    </div>
  );
}
