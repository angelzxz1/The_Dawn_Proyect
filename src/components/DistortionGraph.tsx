"use client";

import { useMemo } from "react";
import { distortionTransfer, type DistortionShape } from "@/lib/distortionModel";

interface DistortionGraphProps {
  shape: DistortionShape;
  drive: number;
  bias: number;
  outputDb: number;
  wet: number;
}

const WIDTH = 840;
const HEIGHT = 160;
const INSET = { x: 12, y: 12, size: HEIGHT - 24 };
const WAVE_X0 = INSET.x + INSET.size + 24;
const WAVE_X1 = WIDTH - 14;
const WAVE_MID = HEIGHT / 2;
const WAVE_RANGE = 1.35;
const TEST_AMPLITUDE = 0.8;
const POINTS = 360;

/** Left: the transfer curve (input across, output up) against the dashed
 * unity line. Right: two cycles of a test sine (IN) and what comes out
 * (OUT) - DC removed, Output gain and the dry/wet blend applied, as in the
 * audio path. (The Tone filter's smoothing isn't simulated.) */
export function DistortionGraph({ shape, drive, bias, outputDb, wet }: DistortionGraphProps) {
  const { transferPath, inPath, outPath } = useMemo(() => {
    const t = (x: number) => distortionTransfer(shape, drive, bias, x);
    const clampY = (v: number, range: number) => Math.max(-range, Math.min(range, v));

    const transfer: string[] = [];
    for (let i = 0; i <= POINTS; i++) {
      const x = (i / POINTS) * 2 - 1;
      const px = INSET.x + ((x + 1) / 2) * INSET.size;
      const py = INSET.y + ((1.1 - clampY(t(x), 1.1)) / 2.2) * INSET.size;
      transfer.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    }

    const samples = Array.from({ length: POINTS + 1 }, (_, i) => TEST_AMPLITUDE * Math.sin((i / POINTS) * 4 * Math.PI));
    const shaped = samples.map(t);
    const mean = shaped.reduce((s, v) => s + v, 0) / shaped.length;
    const gain = Math.pow(10, outputDb / 20);
    const dry = Math.cos((wet * Math.PI) / 2);
    const wetGain = Math.sin((wet * Math.PI) / 2);
    const xAt = (i: number) => WAVE_X0 + (i / POINTS) * (WAVE_X1 - WAVE_X0);
    const yAt = (v: number) => WAVE_MID - (clampY(v, WAVE_RANGE) / WAVE_RANGE) * (HEIGHT / 2 - 10);
    const inPts = samples.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
    const outPts = shaped.map((v, i) => `${xAt(i).toFixed(1)},${yAt(dry * samples[i] + wetGain * gain * (v - mean)).toFixed(1)}`);

    return {
      transferPath: `M${transfer.join(" L")}`,
      inPath: `M${inPts.join(" L")}`,
      outPath: `M${outPts.join(" L")}`,
    };
  }, [shape, drive, bias, outputDb, wet]);

  return (
    <div style={{ background: "#14151A", border: "1px solid #2E2F37", borderRadius: 10, overflow: "hidden", position: "relative" }}>
      <div className="absolute right-3 top-2 flex items-center gap-3 font-mono text-[11px]" style={{ color: "#9A9AA4" }}>
        <span className="flex items-center gap-1.5">
          IN
          <svg width="12" height="4" aria-hidden="true">
            <line x1="0" y1="2" x2="12" y2="2" stroke="#9A9AA4" strokeWidth="1.5" strokeDasharray="3 2" />
          </svg>
        </span>
        <span className="flex items-center gap-1.5">
          OUT <span className="inline-block h-[2px] w-3 rounded-full" style={{ background: "#E6AD5E" }} />
        </span>
      </div>
      <svg
        width="100%"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        fill="none"
        role="img"
        aria-label={`${shape} distortion transfer curve and waveform`}
        style={{ display: "block" }}
      >
        <rect x={INSET.x} y={INSET.y} width={INSET.size} height={INSET.size} rx={6} fill="#1B1C22" />
        <line x1={INSET.x + INSET.size / 2} y1={INSET.y} x2={INSET.x + INSET.size / 2} y2={INSET.y + INSET.size} stroke="#2E2F37" />
        <line x1={INSET.x} y1={INSET.y + INSET.size / 2} x2={INSET.x + INSET.size} y2={INSET.y + INSET.size / 2} stroke="#2E2F37" />
        {/* Unity (y = x): input -1..1 across, output plotted over -1.1..1.1. */}
        <line
          x1={INSET.x}
          y1={INSET.y + (2.1 / 2.2) * INSET.size}
          x2={INSET.x + INSET.size}
          y2={INSET.y + (0.1 / 2.2) * INSET.size}
          stroke="#5A5B64"
          strokeDasharray="3 3"
        />
        <path d={transferPath} stroke="#E6AD5E" strokeWidth={2.5} strokeLinejoin="round" />

        <line x1={WAVE_X0} y1={WAVE_MID} x2={WAVE_X1} y2={WAVE_MID} stroke="#2E2F37" />
        <path d={inPath} stroke="#9A9AA4" strokeWidth={1.5} strokeDasharray="4 4" />
        <path d={outPath} stroke="#E6AD5E" strokeWidth={2.5} strokeLinejoin="round" />
      </svg>
    </div>
  );
}
