"use client";

import { useMemo } from "react";
import { buildDelayTicks, DELAY_GRAPH_HEIGHT, DELAY_GRAPH_WIDTH } from "@/lib/delayCurve";

interface DelayGraphProps {
  delayTimeL: number;
  delayTimeR: number;
  feedback: number;
  wet: number;
  pingPong: boolean;
  filterOn: boolean;
  lowCut: number;
  highCut: number;
}

const L_CENTER_Y = DELAY_GRAPH_HEIGHT * 0.3;
const R_CENTER_Y = DELAY_GRAPH_HEIGHT * 0.72;

function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${Math.round(hz)} Hz`;
}

/** A stylized tap display for the Delay window - decaying echoes for the
 * left/right channels (or a single bouncing train while Ping-Pong is on)
 * plotted against time, matching the shape of information a hardware
 * delay's own display would show. */
export function DelayGraph({ delayTimeL, delayTimeR, feedback, wet, pingPong, filterOn, lowCut, highCut }: DelayGraphProps) {
  const ticks = useMemo(
    () => buildDelayTicks(delayTimeL, delayTimeR, feedback, wet, pingPong),
    [delayTimeL, delayTimeR, feedback, wet, pingPong]
  );

  return (
    <div style={{ background: "#14151A", border: "1px solid #2E2F37", borderRadius: 10, overflow: "hidden", position: "relative" }}>
      {filterOn && (
        <div
          className="absolute left-2.5 top-2 rounded px-2 py-0.5 font-mono text-[10px]"
          style={{ background: "#1B1C22", border: "1px solid #2E2F37", color: "#E6AD5E" }}
        >
          HP {formatHz(lowCut)} · LP {formatHz(highCut)}
        </div>
      )}
      <svg
        width="100%"
        viewBox={`0 0 ${DELAY_GRAPH_WIDTH} ${DELAY_GRAPH_HEIGHT}`}
        fill="none"
        aria-label="Delay taps"
        style={{ display: "block" }}
      >
        {[0.5, 1, 1.5, 2].map((s) => (
          <line
            key={s}
            x1={(s / 2.2) * DELAY_GRAPH_WIDTH}
            y1={0}
            x2={(s / 2.2) * DELAY_GRAPH_WIDTH}
            y2={DELAY_GRAPH_HEIGHT}
            stroke="#23242B"
          />
        ))}
        <line x1={0} y1={L_CENTER_Y} x2={DELAY_GRAPH_WIDTH} y2={L_CENTER_Y} stroke="#2E2F37" />
        <line x1={0} y1={R_CENTER_Y} x2={DELAY_GRAPH_WIDTH} y2={R_CENTER_Y} stroke="#2E2F37" />
        {/* The input transient itself, at the left edge. */}
        <line x1={2} y1={L_CENTER_Y - DELAY_GRAPH_HEIGHT * 0.32} x2={2} y2={R_CENTER_Y + DELAY_GRAPH_HEIGHT * 0.18} stroke="#5A5B64" strokeWidth={2} />
        {ticks.map((tick, i) => {
          const centerY = tick.channel === "L" ? L_CENTER_Y : R_CENTER_Y;
          return (
            <line
              key={i}
              x1={tick.x}
              y1={centerY - tick.height}
              x2={tick.x}
              y2={centerY + tick.height * 0.3}
              stroke="#E6AD5E"
              strokeWidth={2.5}
              strokeLinecap="round"
            />
          );
        })}
        <text x={DELAY_GRAPH_WIDTH - 18} y={L_CENTER_Y - DELAY_GRAPH_HEIGHT * 0.28} fill="#8A8A94" fontSize={10} fontWeight={600} letterSpacing={1}>
          L
        </text>
        <text x={DELAY_GRAPH_WIDTH - 18} y={R_CENTER_Y + DELAY_GRAPH_HEIGHT * 0.22} fill="#8A8A94" fontSize={10} fontWeight={600} letterSpacing={1}>
          R
        </text>
      </svg>
    </div>
  );
}
