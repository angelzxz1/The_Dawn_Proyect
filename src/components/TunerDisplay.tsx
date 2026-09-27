"use client";

import { useEffect, useRef, useState } from "react";
import { audioEngine } from "@/lib/audioEngine";
import { detectPitch, noteFor, type NoteReading } from "@/lib/tunerModel";

/** Readings per second. */
const RATE = 20;
/** How long a note stays on screen after the sound stops (ms). */
const HOLD_MS = 700;
/** History kept for the window's graph: 6 s. */
export const TUNER_HISTORY = RATE * 6;

export interface TunerState {
  /** The current note, or null when there's no clear pitch. */
  note: (NoteReading & { freq: number }) | null;
  /** Cents off per reading, oldest first (null: no pitch then). */
  history: (number | null)[];
}

/** Colour for how far off a note is: in tune, close, off. */
export function tuneColor(cents: number): string {
  const a = Math.abs(cents);
  return a <= 3 ? "#6BD68B" : a <= 15 ? "#E6AD5E" : "#FF6B6B";
}

/** Detects the pitch going into one Tuner, ~20 times a second, while this
 * is mounted. Readings are steadied with a median of the last few. */
export function useTuner(hostId: string | undefined, effectId: string, reference: number, flats: boolean): TunerState {
  const [state, setState] = useState<TunerState>({ note: null, history: [] });
  const recent = useRef<number[]>([]);
  const lastSeen = useRef(0);
  const settings = useRef({ reference, flats });
  useEffect(() => {
    settings.current = { reference, flats };
  });

  useEffect(() => {
    if (!hostId) return;
    const timer = setInterval(() => {
      const data = audioEngine.getTunerWaveform(hostId, effectId);
      const reading = data ? detectPitch(data, audioEngine.sampleRate) : null;
      const now = performance.now();
      if (reading) {
        // A jump of more than a semitone restarts the smoothing.
        const last = recent.current[recent.current.length - 1];
        if (last && Math.abs(1200 * Math.log2(reading.freq / last)) > 100) recent.current = [];
        recent.current.push(reading.freq);
        if (recent.current.length > 5) recent.current.shift();
        lastSeen.current = now;
      } else if (now - lastSeen.current > HOLD_MS) {
        recent.current = [];
      }
      const sorted = [...recent.current].sort((a, b) => a - b);
      const freq = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
      const { reference: ref, flats: fl } = settings.current;
      const note = freq ? { ...noteFor(freq, ref, fl), freq } : null;
      setState((prev) => ({
        note,
        history: [...prev.history.slice(-(TUNER_HISTORY - 1)), reading && note ? note.cents : null],
      }));
    }, 1000 / RATE);
    return () => clearInterval(timer);
  }, [hostId, effectId]);

  return state;
}

/** A needle over a -50..+50 cent arc, with the note in the middle. */
export function TunerNeedle({ note, size = 300 }: { note: TunerState["note"]; size?: number }) {
  const w = size;
  const h = size * 0.62;
  const cx = w / 2;
  const cy = h * 0.95;
  const r = w * 0.42;
  const point = (cents: number, radius: number) => {
    const a = (cents / 50) * (Math.PI / 3); // +-60 degrees
    return { x: cx + radius * Math.sin(a), y: cy - radius * Math.cos(a) };
  };
  const cents = note ? Math.max(-50, Math.min(50, note.cents)) : 0;
  const color = note ? tuneColor(note.cents) : "#3A3B44";
  const tip = point(cents, r * 1.02);
  const base = point(cents, r * 0.72);
  const ticks = [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label="Tuner">
      {/* In-tune zone */}
      <path
        d={`M${point(-3, r).x},${point(-3, r).y} A${r},${r} 0 0 1 ${point(3, r).x},${point(3, r).y}`}
        stroke="#6BD68B"
        strokeOpacity={0.5}
        strokeWidth={10}
        fill="none"
      />
      {ticks.map((t) => {
        const a = point(t, r + (t % 50 === 0 || t === 0 ? 14 : 8));
        const b = point(t, r - 2);
        return <line key={t} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={t === 0 ? "#F4EDE2" : "#4A4B55"} strokeWidth={t === 0 ? 2 : 1.2} />;
      })}
      {[-50, 50].map((t) => {
        const p = point(t, r + 26);
        return (
          <text key={t} x={p.x} y={p.y} fill="#6A6B75" fontSize={11} fontFamily="monospace" textAnchor="middle">
            {t > 0 ? "+50" : "-50"}
          </text>
        );
      })}
      {/* A pointer riding the arc, clear of the note name. */}
      <line x1={base.x} y1={base.y} x2={tip.x} y2={tip.y} stroke={color} strokeWidth={4} strokeLinecap="round" />
      <text x={cx} y={cy - r * 0.34} fill={note ? "#F4EDE2" : "#4A4B55"} fontSize={w * 0.17} fontWeight={700} textAnchor="middle">
        {note ? note.name : "–"}
        {note && (
          <tspan fontSize={w * 0.07} fill="#9A9AA4" dx={2}>
            {note.octave}
          </tspan>
        )}
      </text>
    </svg>
  );
}

/** The last few seconds of tuning: cents off over time, in-tune band in
 * the middle. */
export function TunerHistory({ history, width, height }: { history: (number | null)[]; width: number; height: number }) {
  const y = (c: number) => height / 2 - (Math.max(-50, Math.min(50, c)) / 50) * (height / 2 - 4);
  const x = (i: number) => width - (history.length - 1 - i) * (width / (TUNER_HISTORY - 1));
  const segments: string[] = [];
  let current = "";
  history.forEach((c, i) => {
    if (c === null) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    current += `${current ? " L" : "M"}${x(i).toFixed(1)},${y(c).toFixed(1)}`;
  });
  if (current) segments.push(current);
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block", background: "#101115", borderRadius: 8 }} aria-label="Tuning history">
      <rect x={0} y={y(3)} width={width} height={y(-3) - y(3)} fill="#6BD68B" fillOpacity={0.12} />
      {[-25, 25].map((c) => (
        <line key={c} x1={0} y1={y(c)} x2={width} y2={y(c)} stroke="#1D1E24" />
      ))}
      <line x1={0} y1={y(0)} x2={width} y2={y(0)} stroke="#2A2B33" />
      {segments.map((d, i) => (
        <path key={i} d={d} stroke="#F4EDE2" strokeWidth={2} fill="none" strokeLinejoin="round" />
      ))}
      <text x={6} y={14} fill="#5A5B64" fontSize={10} fontFamily="monospace">
        sharp
      </text>
      <text x={6} y={height - 6} fill="#5A5B64" fontSize={10} fontFamily="monospace">
        flat
      </text>
    </svg>
  );
}
