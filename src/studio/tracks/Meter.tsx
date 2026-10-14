"use client";

import { useEffect, useRef } from "react";
import { audioEngine } from "@/engine/audioEngine";

interface MeterProps {
  channelId: string | "master";
}

const PEAK_DECAY_PER_SEC = 0.6;
const SIDES = ["Left", "Right"] as const;

/** A track's (or the master's) output level: two bars, left and right,
 * each with a falling peak mark. */
export function Meter({ channelId }: MeterProps) {
  const fillRefs = useRef<(HTMLDivElement | null)[]>([]);
  const peakRefs = useRef<(HTMLDivElement | null)[]>([]);
  const peakLevels = useRef([0, 0]);
  const lastFrame = useRef<number | null>(null);

  useEffect(() => {
    let frame: number;

    const tick = (now: number) => {
      const dt = lastFrame.current ? (now - lastFrame.current) / 1000 : 0;
      lastFrame.current = now;

      const levels = channelId === "master" ? audioEngine.getMasterLevels() : audioEngine.getLevels(channelId);
      levels.forEach((raw, side) => {
        const level = Math.min(1, Math.max(0, raw));
        const peak = Math.max(level, peakLevels.current[side] - PEAK_DECAY_PER_SEC * dt);
        peakLevels.current[side] = peak;
        const fill = fillRefs.current[side];
        if (fill) fill.style.clipPath = `inset(${(1 - level) * 100}% 0 0 0)`;
        const mark = peakRefs.current[side];
        if (mark) mark.style.bottom = `${peak * 100}%`;
      });

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [channelId]);

  return (
    <div className="flex h-full w-3 gap-px overflow-hidden rounded-sm border border-border bg-black/50">
      {SIDES.map((side, i) => (
        <div key={side} title={side} className="relative h-full flex-1">
          <div
            ref={(el) => {
              fillRefs.current[i] = el;
            }}
            className="absolute inset-0"
            style={{
              clipPath: "inset(100% 0 0 0)",
              background: "linear-gradient(to top, #4ade80 0%, #4ade80 62%, #facc15 82%, #ff5a5a 100%)",
            }}
          />
          <div
            ref={(el) => {
              peakRefs.current[i] = el;
            }}
            className="absolute left-0 h-[2px] w-full bg-white/80"
            style={{ bottom: "0%" }}
          />
        </div>
      ))}
    </div>
  );
}
