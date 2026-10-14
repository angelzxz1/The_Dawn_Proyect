"use client";

import { useEffect, useRef, type RefObject } from "react";
import { audioEngine } from "@/engine/audioEngine";

interface LimiterMetersProps {
  hostId: string;
  effectId: string;
  gainDb: number;
  ceilingDb: number;
  /** A span elsewhere in the window (the footer's "Limiting ..." readout)
   * that this loop keeps updated alongside the bars. */
  limitingReadoutRef?: RefObject<HTMLSpanElement | null>;
}

const METER_MIN = -36;
const METER_MAX = 6;
const GR_MAX = 12;
const GRID_DB = [-24, -12, -6];
const LEVEL_FALL_DB_PER_S = 24;
const GR_FALL_DB_PER_S = 18;

function levelFraction(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db - METER_MIN) / (METER_MAX - METER_MIN)));
}

function pct(f: number): string {
  return `${(f * 100).toFixed(2)}%`;
}

/** The Limiter window's meter panel: input level after Gain (the part above
 * the ceiling in orange - what's being limited), output level (never past
 * the dashed ceiling line), and gain reduction on a 0-12dB bar. Readings
 * come from the limiter's own audio thread; one RAF loop applies meter
 * ballistics (instant rise, steady fall) and writes the DOM directly, like
 * the Compressor's meters, instead of re-rendering React every frame. */
export function LimiterMeters({ hostId, effectId, gainDb, ceilingDb, limitingReadoutRef }: LimiterMetersProps) {
  const inputFill = useRef<HTMLDivElement>(null);
  const overFill = useRef<HTMLDivElement>(null);
  const outputFill = useRef<HTMLDivElement>(null);
  const grFill = useRef<HTMLDivElement>(null);
  const caption = useRef<HTMLSpanElement>(null);
  const props = useRef({ gainDb, ceilingDb });
  useEffect(() => {
    props.current = { gainDb, ceilingDb };
  }, [gainDb, ceilingDb]);

  useEffect(() => {
    let frame: number;
    let last = performance.now();
    let shownIn = -Infinity;
    let shownOut = -Infinity;
    let shownGr = 0;
    let lastCaption = "";
    let lastLimiting = "";

    const fall = (shown: number, target: number, rate: number, dt: number) => {
      if (!(target < shown)) return target;
      const next = shown - rate * dt;
      return next < METER_MIN - 6 ? -Infinity : Math.max(target, next);
    };

    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const levels = audioEngine.getLimiterMeters(hostId, effectId);
      shownIn = fall(shownIn, levels?.inputDb ?? -Infinity, LEVEL_FALL_DB_PER_S, dt);
      shownOut = fall(shownOut, levels?.outputDb ?? -Infinity, LEVEL_FALL_DB_PER_S, dt);
      const gr = levels?.reductionDb ?? 0;
      shownGr = gr >= shownGr ? gr : Math.max(gr, shownGr - GR_FALL_DB_PER_S * dt);

      const { gainDb: g, ceilingDb: c } = props.current;
      const inF = levelFraction(shownIn);
      const ceilF = levelFraction(c);
      if (inputFill.current) inputFill.current.style.width = pct(Math.min(inF, ceilF));
      if (overFill.current) {
        overFill.current.style.left = pct(ceilF);
        overFill.current.style.width = pct(Math.max(0, inF - ceilF));
      }
      if (outputFill.current) outputFill.current.style.width = pct(levelFraction(shownOut));
      if (grFill.current) grFill.current.style.width = pct(Math.min(1, shownGr / GR_MAX));

      const sourcePeak = Number.isFinite(shownIn) ? `${(shownIn - g).toFixed(1)} dBFS` : "-∞";
      const captionText = `GR 0 → ${GR_MAX} dB · source peak ${sourcePeak}`;
      if (caption.current && captionText !== lastCaption) {
        caption.current.textContent = captionText;
        lastCaption = captionText;
      }
      const limitingText = `Limiting ${shownGr >= 0.05 ? `-${shownGr.toFixed(1)}` : "0.0"} dB`;
      if (limitingReadoutRef?.current && limitingText !== lastLimiting) {
        limitingReadoutRef.current.textContent = limitingText;
        lastLimiting = limitingText;
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [hostId, effectId, limitingReadoutRef]);

  const ceilingPct = pct(levelFraction(ceilingDb));
  const track = { background: "#1F2027" };

  return (
    <div
      className="flex flex-col"
      style={{ background: "#14151A", border: "1px solid #2E2F37", borderRadius: 10, padding: "14px 64px 12px" }}
    >
      <div className="relative flex flex-col gap-[18px] py-1.5">
        {GRID_DB.map((db) => (
          <div
            key={db}
            className="absolute bottom-0 top-0 w-px"
            style={{ left: pct(levelFraction(db)), background: "#23242B" }}
            aria-hidden="true"
          />
        ))}
        <div className="relative h-[18px] overflow-hidden rounded-sm" style={track} aria-hidden="true">
          <div ref={inputFill} className="absolute inset-y-0 left-0" style={{ width: 0, background: "#8A8A94" }} />
          <div ref={overFill} className="absolute inset-y-0" style={{ width: 0, background: "#C8742A" }} />
        </div>
        <div className="relative h-[18px] overflow-hidden rounded-sm" style={track} aria-hidden="true">
          <div ref={outputFill} className="absolute inset-y-0 left-0" style={{ width: 0, background: "#F4EDE2" }} />
        </div>
        <div
          className="absolute bottom-0 top-0"
          style={{ left: ceilingPct, borderLeft: "2px dashed #E6AD5E", transform: "translateX(-1px)" }}
          title={`Ceiling ${ceilingDb.toFixed(1)} dB`}
          aria-hidden="true"
        />
      </div>

      <div className="relative mt-7 h-[18px] overflow-hidden rounded-sm" style={track} aria-hidden="true">
        <div ref={grFill} className="absolute inset-y-0 left-0" style={{ width: 0, background: "#E6AD5E" }} />
      </div>
      <span ref={caption} className="mt-1.5 font-mono text-[11px] text-muted">
        GR 0 → {GR_MAX} dB · source peak -∞
      </span>
    </div>
  );
}
