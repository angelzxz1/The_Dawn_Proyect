"use client";

import { useMemo } from "react";
import { earlyReflections, highsRt60, tailBuildUp, type ReverbMode } from "@/lib/reverbModel";

interface ReverbGraphProps {
  preDelay: number;
  decay: number;
  damping: number;
  early: number;
  lowCut: number;
  highCut: number;
  mode: ReverbMode;
}

const WIDTH = 820;
const HEIGHT = 150;
const CENTER_Y = HEIGHT * 0.52;
const MAX_UP = HEIGHT * 0.36;
const X0 = 26;
const X1 = WIDTH - 12;
const FLOOR_DB = -48;
const TAIL_REF_DB = -12;
const BAR_STEP_PX = 5.5;
const WINDOWS = [0.5, 1, 2, 4, 8, 16];
const LN_1000 = Math.log(1000);

function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${Math.round(hz)} Hz`;
}

function formatSeconds(s: number): string {
  return s < 1 ? `${Math.round(s * 1000)}ms` : `${s % 1 === 0 ? s.toFixed(0) : s.toFixed(1)}s`;
}

/** 0..1 bar height for a level in dB, over a 48dB display range. */
function heightFor(db: number): number {
  return Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB));
}

/** The reverb's response to a single hit: the dry input at the left edge,
 * the early reflections, then the diffuse tail - all from the same model
 * the engine renders into its impulse, drawn in dB so the decay reads as a
 * straight-ish slope. The dashed line is the level of the highs above the
 * Damping frequency, which die away faster. */
export function ReverbGraph({ preDelay, decay, damping, early, lowCut, highCut, mode }: ReverbGraphProps) {
  const { viewSeconds, bars, taps, highsPath } = useMemo(() => {
    const span = (preDelay + decay * 0.8 + 0.05) * 1.6;
    const viewSeconds = WINDOWS.find((w) => w >= span) ?? WINDOWS[WINDOWS.length - 1];
    const xAt = (t: number) => X0 + (t / viewSeconds) * (X1 - X0);
    const highs = highsRt60(decay, damping);

    const taps = early > 0.001
      ? earlyReflections(mode, 0).map((tap) => ({
          x: xAt(preDelay + tap.time),
          h: heightFor(20 * Math.log10(early * Math.abs(tap.gain))),
        }))
      : [];

    const bars: { x: number; h: number }[] = [];
    const highsPoints: string[] = [];
    for (let x = xAt(preDelay) + 3; x <= X1; x += BAR_STEP_PX) {
      const t = ((x - X0) / (X1 - X0)) * viewSeconds - preDelay;
      const build = tailBuildUp(mode, t);
      if (build <= 0) continue;
      const full = heightFor(TAIL_REF_DB + 20 * Math.log10(build * Math.exp((-LN_1000 * t) / decay)));
      const high = heightFor(TAIL_REF_DB + 20 * Math.log10(build * Math.exp((-LN_1000 * t) / highs)));
      if (full <= 0) break;
      bars.push({ x, h: full });
      if (high > 0) highsPoints.push(`${x.toFixed(1)},${(CENTER_Y - high * MAX_UP - 3).toFixed(1)}`);
    }
    return { viewSeconds, bars, taps, highsPath: highsPoints.join(" ") };
  }, [preDelay, decay, damping, early, mode]);

  const gridTimes = [0.25, 0.5, 0.75].map((f) => f * viewSeconds);

  return (
    <div style={{ background: "#14151A", border: "1px solid #2E2F37", borderRadius: 10, overflow: "hidden", position: "relative" }}>
      <div
        className="absolute left-9 top-2 rounded px-2 py-0.5 font-mono text-[11px]"
        style={{ background: "#1B1C22", border: "1px solid #2E2F37", color: "#D9D4CC" }}
      >
        IN {formatHz(lowCut)} – {formatHz(highCut)}
      </div>
      <div className="absolute right-3 top-2 flex items-center gap-3 font-mono text-[11px]" style={{ color: "#9A9AA4" }}>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-[3px] w-3 rounded-full" style={{ background: "#E6AD5E" }} />
          Full band
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="12" height="4" aria-hidden="true">
            <line x1="0" y1="2" x2="12" y2="2" stroke="#9A9AA4" strokeWidth="1.5" strokeDasharray="3 2" />
          </svg>
          Highs
        </span>
      </div>
      <svg
        width="100%"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        fill="none"
        role="img"
        aria-label={`Reverb response over ${formatSeconds(viewSeconds)}`}
        style={{ display: "block" }}
      >
        {gridTimes.map((t) => {
          const x = X0 + (t / viewSeconds) * (X1 - X0);
          return (
            <g key={t}>
              <line x1={x} y1={0} x2={x} y2={HEIGHT} stroke="#23242B" />
              <text x={x + 4} y={HEIGHT - 6} fill="#4A4B54" fontSize={9} fontFamily="monospace">
                {formatSeconds(t)}
              </text>
            </g>
          );
        })}
        <line x1={0} y1={CENTER_Y} x2={WIDTH} y2={CENTER_Y} stroke="#2E2F37" />

        {/* The dry input hit. */}
        <rect x={X0 - 9} y={CENTER_Y - MAX_UP * 1.25} width={4} height={MAX_UP * 1.25 * 1.55} rx={2} fill="#D9D4CC" />

        {bars.map((b, i) => (
          <line
            key={`b${i}`}
            x1={b.x}
            y1={CENTER_Y - b.h * MAX_UP}
            x2={b.x}
            y2={CENTER_Y + b.h * MAX_UP * 0.3}
            stroke="#E6AD5E"
            strokeOpacity={0.35 + 0.65 * b.h}
            strokeWidth={3}
            strokeLinecap="round"
          />
        ))}
        {taps.map((tap, i) => (
          <line
            key={`t${i}`}
            x1={tap.x}
            y1={CENTER_Y - tap.h * MAX_UP * 1.1}
            x2={tap.x}
            y2={CENTER_Y + tap.h * MAX_UP * 0.35}
            stroke="#E9DCC6"
            strokeOpacity={0.55 + 0.4 * tap.h}
            strokeWidth={2}
            strokeLinecap="round"
          />
        ))}
        {highsPath && (
          <polyline points={highsPath} stroke="#9A9AA4" strokeWidth={1.5} strokeDasharray="3 3" fill="none" />
        )}
      </svg>
    </div>
  );
}
