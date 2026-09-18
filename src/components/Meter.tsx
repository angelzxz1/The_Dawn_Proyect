"use client";

import { useEffect, useRef } from "react";
import { audioEngine } from "@/lib/audioEngine";

interface MeterProps {
  channelId: string;
}

const PEAK_DECAY_PER_SEC = 0.6;

export function Meter({ channelId }: MeterProps) {
  const fillRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLDivElement>(null);
  const peakLevel = useRef(0);
  const lastFrame = useRef<number | null>(null);

  useEffect(() => {
    let frame: number;

    const tick = (now: number) => {
      const dt = lastFrame.current ? (now - lastFrame.current) / 1000 : 0;
      lastFrame.current = now;

      const level = Math.min(1, Math.max(0, audioEngine.getLevel(channelId)));
      peakLevel.current = Math.max(
        level,
        peakLevel.current - PEAK_DECAY_PER_SEC * dt
      );

      if (fillRef.current) {
        fillRef.current.style.clipPath = `inset(${(1 - level) * 100}% 0 0 0)`;
      }
      if (peakRef.current) {
        peakRef.current.style.bottom = `${peakLevel.current * 100}%`;
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [channelId]);

  return (
    <div className="relative h-full w-3 overflow-hidden rounded-sm border border-border bg-black/50">
      <div
        ref={fillRef}
        className="absolute inset-0"
        style={{
          clipPath: "inset(100% 0 0 0)",
          background:
            "linear-gradient(to top, #4ade80 0%, #4ade80 62%, #facc15 82%, #ff5a5a 100%)",
        }}
      />
      <div
        ref={peakRef}
        className="absolute left-0 h-[2px] w-full bg-white/80"
        style={{ bottom: "0%" }}
      />
    </div>
  );
}
