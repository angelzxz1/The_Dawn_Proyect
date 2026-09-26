"use client";

import { useMemo } from "react";
import * as Tone from "tone";
import { LFO_MAX_OCTAVES, designFilter, filterResponseDb, type FilterMode } from "@/lib/filterModel";

interface FilterGraphProps {
  mode: FilterMode;
  frequency: number;
  q: number;
  gainDb: number;
  slopeIndex: number;
  wet: number;
  lfoDepth: number;
}

const WIDTH = 840;
const HEIGHT = 160;
const X0 = 18;
const X1 = WIDTH - 18;
const F_MIN = 20;
const F_MAX = 20000;
const DB_TOP = 18;
const DB_BOTTOM = -36;
const POINTS = 260;

const xFor = (f: number) => X0 + (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * (X1 - X0);
const yFor = (db: number) => ((DB_TOP - Math.max(DB_BOTTOM, Math.min(DB_TOP, db))) / (DB_TOP - DB_BOTTOM)) * HEIGHT;

/** The filter's actual frequency response (the same biquad math the Web
 * Audio nodes run, including the dry/wet blend), on a log frequency axis,
 * with the cutoff marked and - while the LFO is on - the range it sweeps
 * the cutoff across shaded behind the curve. */
export function FilterGraph({ mode, frequency, q, gainDb, slopeIndex, wet, lfoDepth }: FilterGraphProps) {
  const { line, area } = useMemo(() => {
    const sampleRate = Tone.getContext().sampleRate;
    const stages = designFilter(mode, frequency, q, gainDb, slopeIndex);
    const pts: string[] = [];
    for (let i = 0; i <= POINTS; i++) {
      const f = F_MIN * Math.pow(F_MAX / F_MIN, i / POINTS);
      pts.push(`${xFor(f).toFixed(1)},${yFor(filterResponseDb(stages, wet, f, sampleRate)).toFixed(1)}`);
    }
    const line = `M${pts.join(" L")}`;
    return { line, area: `${line} L${X1},${HEIGHT} L${X0},${HEIGHT} Z` };
  }, [mode, frequency, q, gainDb, slopeIndex, wet]);

  const cutoffX = xFor(Math.max(F_MIN, Math.min(F_MAX, frequency)));
  const sweep = lfoDepth * LFO_MAX_OCTAVES;
  const sweepLo = xFor(Math.max(F_MIN, frequency / Math.pow(2, sweep)));
  const sweepHi = xFor(Math.min(F_MAX, frequency * Math.pow(2, sweep)));

  return (
    <div style={{ background: "#14151A", border: "1px solid #2E2F37", borderRadius: 10, overflow: "hidden" }}>
      <svg
        width="100%"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        fill="none"
        role="img"
        aria-label="Filter frequency response"
        style={{ display: "block" }}
      >
        {[100, 1000, 10000].map((f) => (
          <g key={f}>
            <line x1={xFor(f)} y1={0} x2={xFor(f)} y2={HEIGHT} stroke="#23242B" />
            <text x={xFor(f) + 4} y={HEIGHT - 8} fill="#6E6E78" fontSize={11} fontFamily="monospace">
              {f >= 1000 ? `${f / 1000}k` : f}
            </text>
          </g>
        ))}
        <line x1={0} y1={yFor(0)} x2={WIDTH} y2={yFor(0)} stroke="#2E2F37" />
        <text x={X1 - 4} y={yFor(0) - 6} fill="#6E6E78" fontSize={11} fontFamily="monospace" textAnchor="end">
          0
        </text>

        {sweep > 0 && (
          <g>
            <rect x={sweepLo} y={0} width={Math.max(0, sweepHi - sweepLo)} height={HEIGHT} fill="#E6AD5E" fillOpacity={0.07} />
            <line x1={sweepLo} y1={0} x2={sweepLo} y2={HEIGHT} stroke="#E6AD5E" strokeOpacity={0.35} strokeDasharray="2 4" />
            <line x1={sweepHi} y1={0} x2={sweepHi} y2={HEIGHT} stroke="#E6AD5E" strokeOpacity={0.35} strokeDasharray="2 4" />
          </g>
        )}

        <path d={area} fill="#E6AD5E" fillOpacity={0.14} />
        <path d={line} stroke="#E6AD5E" strokeWidth={2.5} strokeLinejoin="round" />
        <line x1={cutoffX} y1={0} x2={cutoffX} y2={HEIGHT} stroke="#9A9AA4" strokeWidth={1} strokeDasharray="3 3" />
      </svg>
    </div>
  );
}
