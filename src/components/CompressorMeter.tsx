"use client";

import { useEffect, useRef } from "react";
import { audioEngine } from "@/lib/audioEngine";

interface CompressorMetersProps {
  hostId: string;
  effectId: string;
}

const IN_OUT_RANGE: [number, number] = [-60, 6];
const GR_RANGE: [number, number] = [-30, 0];

function fractionFor(db: number, [min, max]: [number, number]): number {
  const clamped = Math.max(min, Math.min(max, Number.isFinite(db) ? db : min));
  return (clamped - min) / (max - min);
}

function formatDb(db: number): string {
  return Number.isFinite(db) && db > -100 ? db.toFixed(1) : "-inf";
}

/** The three live vertical meters (IN / GR / OUT) in the Compressor's full
 * window - a single RAF loop polls all three at once (rather than one
 * per bar) and mutates the bars' DOM directly, the same technique as
 * `Meter.tsx`, to avoid a React re-render every frame. */
export function CompressorMeters({ hostId, effectId }: CompressorMetersProps) {
  const inFill = useRef<HTMLDivElement>(null);
  const grFill = useRef<HTMLDivElement>(null);
  const outFill = useRef<HTMLDivElement>(null);
  const inReadout = useRef<HTMLSpanElement>(null);
  const grReadout = useRef<HTMLSpanElement>(null);
  const outReadout = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let frame: number;

    const tick = () => {
      const meters = audioEngine.getCompressorMeters(hostId, effectId);
      const input = meters?.input ?? -Infinity;
      const reduction = meters?.gainReduction ?? 0;
      const output = meters?.output ?? -Infinity;

      if (inFill.current) inFill.current.style.clipPath = `inset(${(1 - fractionFor(input, IN_OUT_RANGE)) * 100}% 0 0 0)`;
      if (outFill.current) outFill.current.style.clipPath = `inset(${(1 - fractionFor(output, IN_OUT_RANGE)) * 100}% 0 0 0)`;
      // GR hangs from the top: 0dB reduction is empty, more reduction fills
      // downward, matching how a hardware gain-reduction meter reads.
      if (grFill.current) grFill.current.style.clipPath = `inset(0 0 ${(1 - fractionFor(reduction, GR_RANGE)) * 100}% 0)`;

      if (inReadout.current) inReadout.current.textContent = formatDb(input);
      if (grReadout.current) grReadout.current.textContent = formatDb(reduction);
      if (outReadout.current) outReadout.current.textContent = formatDb(output);

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [hostId, effectId]);

  const bar = (fillRef: React.RefObject<HTMLDivElement | null>, color: string) => (
    <div
      className="relative h-full w-3 overflow-hidden rounded-sm"
      style={{ background: "#14151A", border: "1px solid #2E2F37" }}
    >
      <div
        ref={fillRef}
        className="absolute inset-0"
        style={{ clipPath: "inset(100% 0 0 0)", background: color }}
      />
    </div>
  );

  return (
    <div className="flex h-[190px] items-stretch gap-3 px-1">
      <div className="flex flex-1 flex-col items-center gap-1">
        {bar(inFill, "#8A8A94")}
        <span ref={inReadout} className="font-mono text-[9px] text-[#8A8A94]">
          0.0
        </span>
        <span className="text-[9px] font-semibold uppercase tracking-wide text-muted">In</span>
      </div>
      <div className="flex flex-1 flex-col items-center gap-1">
        {bar(grFill, "#E6AD5E")}
        <span ref={grReadout} className="font-mono text-[9px] text-[#8A8A94]">
          0.0
        </span>
        <span className="text-[9px] font-semibold uppercase tracking-wide text-muted">GR</span>
      </div>
      <div className="flex flex-1 flex-col items-center gap-1">
        {bar(outFill, "#F4EDE2")}
        <span ref={outReadout} className="font-mono text-[9px] text-[#8A8A94]">
          0.0
        </span>
        <span className="text-[9px] font-semibold uppercase tracking-wide text-muted">Out</span>
      </div>
    </div>
  );
}
