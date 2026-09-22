"use client";

import { useRef, useState } from "react";

const WHEEL_HEIGHT = 72;
const WHEEL_WIDTH = 22;

/** A vertical drag strip shared by the pitch-bend and mod wheels - only
 * their spring-back-to-rest behavior differs. */
function Wheel({
  value,
  onChange,
  onRelease,
  bipolar,
  label,
  title,
}: {
  /** 0..1 for the mod wheel, -1..1 for pitch-bend. */
  value: number;
  onChange: (v: number) => void;
  /** Called on pointer-up - the pitch wheel springs back to 0 here; the mod
   * wheel (no `onRelease`) just stays wherever it was left, like a real
   * mod wheel. */
  onRelease?: () => void;
  bipolar?: boolean;
  label: string;
  title: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const valueToTop = (v: number) => {
    const ratio = bipolar ? (1 - v) / 2 : 1 - v;
    return Math.min(WHEEL_HEIGHT - 6, Math.max(0, ratio * WHEEL_HEIGHT - 3));
  };

  const yToValue = (clientY: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    return bipolar ? 1 - ratio * 2 : 1 - ratio;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    setDragging(true);
    onChange(yToValue(e.clientY));

    const onMove = (ev: PointerEvent) => onChange(yToValue(ev.clientY));
    const onUp = () => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      setDragging(false);
      if (onRelease) onRelease();
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        title={title}
        className="relative cursor-ns-resize rounded-full border border-border bg-surface-raised"
        style={{ width: WHEEL_WIDTH, height: WHEEL_HEIGHT }}
      >
        {bipolar && (
          <div className="pointer-events-none absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-border" />
        )}
        <div
          className={`pointer-events-none absolute left-0.5 h-1.5 w-[calc(100%-4px)] rounded-full ${
            dragging ? "bg-accent" : "bg-muted"
          }`}
          style={{ top: valueToTop(value) }}
        />
      </div>
      <span className="text-[9px] uppercase tracking-wide text-muted">{label}</span>
    </div>
  );
}

interface ExpressionControlsProps {
  onPitchBend: (semitoneValue: number) => void;
  onModWheel: (amount: number) => void;
  onSustainChange: (down: boolean) => void;
  /** Semitone range a full pitch-bend deflection maps to. */
  pitchBendRangeSemitones: number;
}

/**
 * On-screen stand-ins for a MIDI keyboard's pitch-bend wheel, mod wheel,
 * and sustain pedal - a mouse-only player can reach the same expression
 * controls a hardware controller sends as pitch-bend/CC1/CC64 messages
 * (see webMidi.ts), which the engine (audioEngine.ts) treats identically
 * either way.
 */
export function ExpressionControls({
  onPitchBend,
  onModWheel,
  onSustainChange,
  pitchBendRangeSemitones,
}: ExpressionControlsProps) {
  const [pitch, setPitch] = useState(0);
  const [mod, setMod] = useState(0);
  const [sustain, setSustain] = useState(false);

  return (
    <div className="flex items-center gap-4 px-2">
      <Wheel
        label="Pitch"
        title="Drag to bend pitch - springs back to center on release"
        value={pitch}
        bipolar
        onChange={(v) => {
          setPitch(v);
          onPitchBend(v * pitchBendRangeSemitones);
        }}
        onRelease={() => {
          setPitch(0);
          onPitchBend(0);
        }}
      />
      <Wheel
        label="Mod"
        title="Drag to add modulation - stays where you leave it"
        value={mod}
        onChange={(v) => {
          setMod(v);
          onModWheel(v);
        }}
      />
      <button
        type="button"
        title="Hold to sustain notes (like a sustain pedal)"
        onPointerDown={() => {
          setSustain(true);
          onSustainChange(true);
        }}
        onPointerUp={() => {
          setSustain(false);
          onSustainChange(false);
        }}
        onPointerLeave={() => {
          if (sustain) {
            setSustain(false);
            onSustainChange(false);
          }
        }}
        className={`flex h-9 w-14 select-none items-center justify-center rounded border text-[10px] font-medium uppercase tracking-wide ${
          sustain
            ? "border-accent bg-accent/25 text-accent"
            : "border-border text-muted hover:bg-surface-raised"
        }`}
      >
        Sustain
      </button>
    </div>
  );
}
