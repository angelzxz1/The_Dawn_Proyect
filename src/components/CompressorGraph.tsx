"use client";

import { useMemo } from "react";
import { buildCompressorCurve, dbToX, dbToY, GRAPH_SIZE } from "@/lib/compressorCurve";

interface CompressorGraphProps {
  threshold: number;
  ratio: number;
  knee: number;
}

/** The compressor's classic transfer-function preview: input dB (x) vs.
 * output dB (y), a dashed unity diagonal behind the actual curve, and a
 * dashed marker at the threshold - the standard "knee" graph every
 * compressor plugin shows. */
export function CompressorGraph({ threshold, ratio, knee }: CompressorGraphProps) {
  const curve = useMemo(() => buildCompressorCurve(threshold, ratio, knee), [threshold, ratio, knee]);

  return (
    <div style={{ background: "#14151A", border: "1px solid #2E2F37", borderRadius: 10, overflow: "hidden" }}>
      <svg
        width="100%"
        viewBox={`0 0 ${GRAPH_SIZE} ${GRAPH_SIZE}`}
        fill="none"
        aria-label="Compressor transfer curve"
        style={{ display: "block" }}
      >
        <line x1={0} y1={dbToY(0)} x2={GRAPH_SIZE} y2={dbToY(0)} stroke="#23242B" />
        <line x1={dbToX(0)} y1={0} x2={dbToX(0)} y2={GRAPH_SIZE} stroke="#23242B" />
        <line
          x1={curve.thresholdX}
          y1={0}
          x2={curve.thresholdX}
          y2={GRAPH_SIZE}
          stroke="#E6AD5E"
          strokeOpacity={0.4}
          strokeDasharray="3 3"
        />
        <path d={curve.unity} stroke="#3A3B44" strokeWidth={1} strokeDasharray="2 3" />
        <path d={curve.curve} stroke="#E6AD5E" strokeWidth={2} strokeLinecap="round" />
        <circle cx={curve.knee.x} cy={curve.knee.y} r={3} fill="#F4EDE2" />
        <text x={6} y={GRAPH_SIZE - 6} fill="#6E6E78" fontFamily="var(--font-geist-mono)" fontSize={9}>
          -60
        </text>
        <text x={GRAPH_SIZE - 16} y={GRAPH_SIZE - 6} fill="#6E6E78" fontFamily="var(--font-geist-mono)" fontSize={9}>
          0
        </text>
        <text x={6} y={13} fill="#6E6E78" fontSize={9}>
          IN → OUT
        </text>
        <text x={GRAPH_SIZE - 20} y={13} fill="#6E6E78" fontSize={9}>
          dB
        </text>
      </svg>
    </div>
  );
}
