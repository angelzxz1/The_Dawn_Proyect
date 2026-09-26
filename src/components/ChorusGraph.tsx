"use client";

import { useMemo } from "react";
import { chorusLfoShape, type ChorusWaveform } from "@/lib/chorusModel";

interface ChorusGraphProps {
  rate: number;
  depth: number;
  spread: number;
  waveform: ChorusWaveform;
}

const WIDTH = 840;
const HEIGHT = 150;
const X0 = 18;
const X1 = WIDTH - 18;
const MID = HEIGHT * 0.46;
const AMPLITUDE = HEIGHT * 0.36;
const WINDOWS = [0.5, 1, 2, 4, 8, 16, 40];
const POINTS = 420;

function formatSeconds(s: number): string {
  return s === 0 ? "0" : `${Number.isInteger(s) ? s : s.toFixed(s < 1 ? 2 : 1).replace(/0$/, "")} s`;
}

/** The two LFOs sweeping the left and right delay times over a few cycles:
 * the vertical swing is Depth, the offset between the curves is Spread,
 * and the shape is the chosen waveform. */
export function ChorusGraph({ rate, depth, spread, waveform }: ChorusGraphProps) {
  const { seconds, left, right } = useMemo(() => {
    const seconds = WINDOWS.find((w) => w >= 2.5 / rate) ?? WINDOWS[WINDOWS.length - 1];
    const path = (phaseOffset: number) => {
      const pts: string[] = [];
      for (let i = 0; i <= POINTS; i++) {
        const t = (i / POINTS) * seconds;
        const y = MID - chorusLfoShape(waveform, t * rate + phaseOffset) * depth * AMPLITUDE;
        pts.push(`${(X0 + (i / POINTS) * (X1 - X0)).toFixed(1)},${y.toFixed(1)}`);
      }
      return `M${pts.join(" L")}`;
    };
    return { seconds, left: path(0), right: path(spread / 360) };
  }, [rate, depth, spread, waveform]);

  return (
    <div style={{ background: "#14151A", border: "1px solid #2E2F37", borderRadius: 10, overflow: "hidden", position: "relative" }}>
      <div className="absolute right-3 top-2 flex items-center gap-3 font-mono text-[11px]" style={{ color: "#9A9AA4" }}>
        <span className="flex items-center gap-1.5">
          L <span className="inline-block h-[2px] w-3 rounded-full" style={{ background: "#E6AD5E" }} />
        </span>
        <span className="flex items-center gap-1.5">
          R
          <svg width="12" height="4" aria-hidden="true">
            <line x1="0" y1="2" x2="12" y2="2" stroke="#9A9AA4" strokeWidth="1.5" strokeDasharray="3 2" />
          </svg>
        </span>
      </div>
      <svg
        width="100%"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        fill="none"
        role="img"
        aria-label={`Chorus modulation over ${formatSeconds(seconds)}`}
        style={{ display: "block" }}
      >
        {[0, 0.25, 0.5, 0.75].map((f) => {
          const x = X0 + f * (X1 - X0);
          return (
            <g key={f}>
              {f > 0 && <line x1={x} y1={0} x2={x} y2={HEIGHT} stroke="#23242B" />}
              <text x={x + 4} y={HEIGHT - 8} fill="#6E6E78" fontSize={11} fontFamily="monospace">
                {formatSeconds(f * seconds)}
              </text>
            </g>
          );
        })}
        <line x1={X0} y1={MID} x2={X1} y2={MID} stroke="#3A3B44" strokeDasharray="3 4" />
        <path d={right} stroke="#9A9AA4" strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" />
        <path d={left} stroke="#E6AD5E" strokeWidth={2.5} strokeLinejoin="round" />
      </svg>
    </div>
  );
}
