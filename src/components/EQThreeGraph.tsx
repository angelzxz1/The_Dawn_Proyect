"use client";

import { useMemo } from "react";
import { buildEQCurve, eqFreqToX, EQ_GRAPH_WIDTH, EQ_GRAPH_HEIGHT } from "@/lib/eqThreeCurve";
import { spaceGrotesk } from "@/lib/pluginFonts";

interface EQThreeGraphProps {
  low: number;
  mid: number;
  high: number;
  lowFrequency: number;
  highFrequency: number;
}

/** A stylized (not filter-accurate) frequency-response preview: the low/
 * mid/high gain levels as a smooth curve, with dashed markers at the two
 * crossover frequencies - a live sound-design preview, not a measurement. */
export function EQThreeGraph({ low, mid, high, lowFrequency, highFrequency }: EQThreeGraphProps) {
  const curve = useMemo(
    () => buildEQCurve(low, mid, high, lowFrequency, highFrequency),
    [low, mid, high, lowFrequency, highFrequency]
  );
  const midStartX = eqFreqToX(lowFrequency);
  const midEndX = eqFreqToX(highFrequency);

  return (
    <div
      style={{ background: "#14151A", border: "1px solid #2E2F37", borderRadius: 10, overflow: "hidden" }}
    >
      <svg
        width="100%"
        viewBox={`0 0 ${EQ_GRAPH_WIDTH} ${EQ_GRAPH_HEIGHT}`}
        fill="none"
        aria-label="Frequency response"
        style={{ display: "block" }}
      >
        <rect x={midStartX} y={0} width={Math.max(0, midEndX - midStartX)} height={EQ_GRAPH_HEIGHT} fill="#1B1C22" />
        <line x1={eqFreqToX(100)} y1={0} x2={eqFreqToX(100)} y2={EQ_GRAPH_HEIGHT} stroke="#23242B" />
        <line x1={eqFreqToX(1000)} y1={0} x2={eqFreqToX(1000)} y2={EQ_GRAPH_HEIGHT} stroke="#23242B" />
        <line x1={eqFreqToX(10000)} y1={0} x2={eqFreqToX(10000)} y2={EQ_GRAPH_HEIGHT} stroke="#23242B" />
        <line x1={0} y1={55} x2={EQ_GRAPH_WIDTH} y2={55} stroke="#2E2F37" />
        <path d={curve.fill} fill="#E6AD5E" opacity={0.16} />
        <path d={curve.stroke} stroke="#E6AD5E" strokeWidth={2} strokeLinecap="round" />
        <line
          x1={curve.lowXPixel}
          y1={0}
          x2={curve.lowXPixel}
          y2={EQ_GRAPH_HEIGHT}
          stroke="#E6AD5E"
          strokeOpacity={0.55}
          strokeDasharray="3 3"
        />
        <line
          x1={curve.highXPixel}
          y1={0}
          x2={curve.highXPixel}
          y2={EQ_GRAPH_HEIGHT}
          stroke="#E6AD5E"
          strokeOpacity={0.55}
          strokeDasharray="3 3"
        />
        <text x={10} y={16} fill="#8A8A94" className={spaceGrotesk.className} fontSize={9} fontWeight={600} letterSpacing={1.4}>
          LOW
        </text>
        <text x={midStartX + 8} y={16} fill="#8A8A94" className={spaceGrotesk.className} fontSize={9} fontWeight={600} letterSpacing={1.4}>
          MID
        </text>
        <text x={midEndX + 8} y={16} fill="#8A8A94" className={spaceGrotesk.className} fontSize={9} fontWeight={600} letterSpacing={1.4}>
          HIGH
        </text>
        <text x={eqFreqToX(100) + 4} y={102} fill="#6E6E78" fontFamily="var(--font-geist-mono)" fontSize={9}>
          100
        </text>
        <text x={eqFreqToX(1000) + 4} y={102} fill="#6E6E78" fontFamily="var(--font-geist-mono)" fontSize={9}>
          1k
        </text>
        <text x={eqFreqToX(10000) + 4} y={102} fill="#6E6E78" fontFamily="var(--font-geist-mono)" fontSize={9}>
          10k
        </text>
      </svg>
    </div>
  );
}
