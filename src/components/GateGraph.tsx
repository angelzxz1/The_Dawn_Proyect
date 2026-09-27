"use client";

import { useEffect, useRef } from "react";
import { audioEngine } from "@/lib/audioEngine";
import { HYSTERESIS_DB } from "@/lib/gateModel";

interface GateGraphProps {
  hostId: string;
  effectId: string;
  thresholdDb: number;
}

const WIDTH = 840;
const HEIGHT = 170;
const TOP = 12;
const BOTTOM = HEIGHT - 22;
const STRIP_Y = HEIGHT - 12;
const FLOOR_DB = -96;
const POINTS = 240;
const GRID_DB = [-72, -48, -24];

const yForDb = (db: number) => TOP + (Math.min(0, Math.max(FLOOR_DB, db)) / FLOOR_DB) * (BOTTOM - TOP);
const xForIndex = (i: number) => (i / (POINTS - 1)) * WIDTH;

/** The last ~5 seconds, scrolling right to left: the input level (grey
 * area), what the gate lets through (amber), the threshold (dashed) with
 * the lower level it has to fall below to close (faint), and a strip along
 * the bottom that's lit while the gate is open. Redrawn every frame from
 * the gate's own meter readings, without re-rendering React. */
export function GateGraph({ hostId, effectId, thresholdDb }: GateGraphProps) {
  const inputArea = useRef<SVGPathElement>(null);
  const outputLine = useRef<SVGPathElement>(null);
  const openStrip = useRef<SVGPathElement>(null);
  const status = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let frame: number;
    let lastStatus = "";
    const draw = () => {
      const history = audioEngine.getGateHistory(hostId, effectId) ?? [];
      const offset = POINTS - history.length;
      let area = "";
      let line = "";
      let strip = "";
      history.forEach((r, k) => {
        const x = xForIndex(offset + k).toFixed(1);
        const yIn = yForDb(r.inputDb).toFixed(1);
        const yOut = yForDb(r.inputDb + r.gainDb).toFixed(1);
        area += `${k === 0 ? `M${x},${BOTTOM} L` : " L"}${x},${yIn}`;
        line += `${k === 0 ? "M" : " L"}${x},${yOut}`;
        if (r.open) strip += `M${x},${STRIP_Y}h${(WIDTH / POINTS + 0.6).toFixed(1)}`;
      });
      if (history.length) area += ` L${xForIndex(POINTS - 1)},${BOTTOM} Z`;
      inputArea.current?.setAttribute("d", area);
      outputLine.current?.setAttribute("d", line);
      openStrip.current?.setAttribute("d", strip);
      const last = history[history.length - 1];
      const text = !last ? "No signal" : last.open ? "Open" : "Closed";
      if (text !== lastStatus && status.current) {
        status.current.textContent = text;
        status.current.style.color = text === "Open" ? "#E6AD5E" : "#8A8A94";
        lastStatus = text;
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [hostId, effectId]);

  return (
    <div style={{ background: "#14151A", border: "1px solid #2E2F37", borderRadius: 10, overflow: "hidden", position: "relative" }}>
      <div
        className="absolute right-2 top-1.5 flex items-center gap-3 rounded px-2 py-1 font-mono text-[11px]"
        style={{ color: "#9A9AA4", background: "rgba(20,21,26,0.9)" }}
      >
        <span className="flex items-center gap-1.5">
          IN <span className="inline-block h-2 w-3 rounded-sm" style={{ background: "#3A3B44" }} />
        </span>
        <span className="flex items-center gap-1.5">
          OUT <span className="inline-block h-[2px] w-3 rounded-full" style={{ background: "#E6AD5E" }} />
        </span>
        <span ref={status} className="w-16 text-right font-semibold uppercase">
          No signal
        </span>
      </div>
      <svg width="100%" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} fill="none" role="img" aria-label="Gate input and output level over time" style={{ display: "block" }}>
        {GRID_DB.map((db) => (
          <g key={db}>
            <line x1={0} y1={yForDb(db)} x2={WIDTH} y2={yForDb(db)} stroke="#1F2026" />
            <text x={6} y={yForDb(db) - 3} fill="#5A5B64" fontSize={10} fontFamily="monospace">
              {db} dB
            </text>
          </g>
        ))}
        <path ref={inputArea} fill="#2A2B33" stroke="#4A4B55" strokeWidth={1} />
        <path ref={outputLine} stroke="#E6AD5E" strokeWidth={2} strokeLinejoin="round" />
        <line x1={0} y1={yForDb(thresholdDb - HYSTERESIS_DB)} x2={WIDTH} y2={yForDb(thresholdDb - HYSTERESIS_DB)} stroke="#E6AD5E" strokeOpacity={0.3} strokeDasharray="2 4" />
        <line x1={0} y1={yForDb(thresholdDb)} x2={WIDTH} y2={yForDb(thresholdDb)} stroke="#E6AD5E" strokeDasharray="6 4" />
        {/* Left of the legend, and under the line when it's near the top. */}
        <text
          x={70}
          y={yForDb(thresholdDb) < TOP + 14 ? yForDb(thresholdDb) + 13 : yForDb(thresholdDb) - 4}
          fill="#E6AD5E"
          fontSize={10}
          fontFamily="monospace"
        >
          Threshold {thresholdDb.toFixed(1)} dB
        </text>
        <line x1={0} y1={STRIP_Y} x2={WIDTH} y2={STRIP_Y} stroke="#23242B" strokeWidth={6} />
        <path ref={openStrip} stroke="#E6AD5E" strokeWidth={6} strokeOpacity={0.8} />
      </svg>
    </div>
  );
}
