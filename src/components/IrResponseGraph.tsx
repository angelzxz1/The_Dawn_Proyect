"use client";

import { useMemo } from "react";
import { convolverChannels, cutFiltersDb, irNormalizationGain, irResponseDb } from "@/lib/irModel";

interface IrResponseGraphProps {
  buffer: AudioBuffer | null;
  /** What to say in place of the curve when there's no IR to draw. */
  emptyMessage: string;
  normalize: boolean;
  lowCut: number;
  highCut: number;
  outputDb: number;
}

const WIDTH = 840;
const HEIGHT = 170;
const WAVE = { x: 12, y: 12, w: 176, h: HEIGHT - 24 };
const RESP_X0 = WAVE.x + WAVE.w + 40;
const RESP_X1 = WIDTH - 14;
const RESP_Y0 = 14;
const RESP_Y1 = HEIGHT - 22;
const SPAN_DB = 48;
const POINTS = 220;
const FREQS = Array.from({ length: POINTS }, (_, i) => 20 * Math.pow(1000, i / (POINTS - 1)));
const GRID_HZ = [50, 100, 200, 500, 1000, 2000, 5000, 10000];

const xForHz = (hz: number) => RESP_X0 + (Math.log(hz / 20) / Math.log(1000)) * (RESP_X1 - RESP_X0);
const hzLabel = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : `${hz}`);

/** Left: the IR's waveform. Right: its frequency response (dashed) and what
 * the wet signal actually gets once Low/High Cut and Output are applied
 * (solid), 20 Hz - 20 kHz, smoothed to 1/6 octave. */
export function IrResponseGraph({ buffer, emptyMessage, normalize, lowCut, highCut, outputDb }: IrResponseGraphProps) {
  const analysis = useMemo(() => {
    if (!buffer) return null;
    const channels = convolverChannels(
      Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
    );
    const gain = normalize ? irNormalizationGain(channels) : 1;
    const response = irResponseDb(channels, buffer.sampleRate, FREQS, gain);

    // Min/max per column of the first channel, scaled to its own peak.
    const data = channels[0];
    const columns = Math.floor(WAVE.w);
    const perColumn = Math.max(1, Math.ceil(data.length / columns));
    let peak = 1e-9;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    const mid = WAVE.y + WAVE.h / 2;
    const wave: string[] = [];
    for (let c = 0; c < columns; c++) {
      let lo = 0;
      let hi = 0;
      for (let i = c * perColumn; i < Math.min(data.length, (c + 1) * perColumn); i++) {
        lo = Math.min(lo, data[i]);
        hi = Math.max(hi, data[i]);
      }
      const x = WAVE.x + c + 0.5;
      wave.push(`M${x},${(mid - (hi / peak) * (WAVE.h / 2 - 6)).toFixed(1)}V${(mid - (lo / peak) * (WAVE.h / 2 - 6) + 0.5).toFixed(1)}`);
    }
    return { response, wavePath: wave.join(""), seconds: buffer.duration };
  }, [buffer, normalize]);

  const curves = useMemo(() => {
    if (!analysis || !buffer) return null;
    const shaped = analysis.response.map(
      (db, i) => db + cutFiltersDb(FREQS[i], lowCut, highCut, buffer.sampleRate) + outputDb
    );
    const peak = Math.max(...analysis.response, ...shaped);
    const top = Math.max(12, Math.ceil((peak + 3) / 12) * 12);
    const bottom = top - SPAN_DB;
    const yForDb = (db: number) =>
      RESP_Y0 + ((top - Math.max(bottom, Math.min(top, db))) / SPAN_DB) * (RESP_Y1 - RESP_Y0);
    const path = (values: number[]) =>
      `M${values.map((db, i) => `${xForHz(FREQS[i]).toFixed(1)},${yForDb(db).toFixed(1)}`).join(" L")}`;
    const gridDb = Array.from({ length: SPAN_DB / 12 + 1 }, (_, i) => top - i * 12);
    return { raw: path(analysis.response), shaped: path(shaped), gridDb, yForDb };
  }, [analysis, buffer, lowCut, highCut, outputDb]);

  const length = analysis
    ? analysis.seconds >= 1
      ? `${analysis.seconds.toFixed(2)} s`
      : `${Math.round(analysis.seconds * 1000)} ms`
    : "";

  return (
    <div style={{ background: "#14151A", border: "1px solid #2E2F37", borderRadius: 10, overflow: "hidden", position: "relative" }}>
      {curves && (
        <div className="absolute right-3 top-2 flex items-center gap-3 font-mono text-[11px]" style={{ color: "#9A9AA4" }}>
          <span className="flex items-center gap-1.5">
            IR
            <svg width="12" height="4" aria-hidden="true">
              <line x1="0" y1="2" x2="12" y2="2" stroke="#9A9AA4" strokeWidth="1.5" strokeDasharray="3 2" />
            </svg>
          </span>
          <span className="flex items-center gap-1.5">
            OUT <span className="inline-block h-[2px] w-3 rounded-full" style={{ background: "#E6AD5E" }} />
          </span>
        </div>
      )}
      <svg
        width="100%"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        fill="none"
        role="img"
        aria-label={analysis ? "Impulse response waveform and frequency response" : emptyMessage}
        style={{ display: "block" }}
      >
        <rect x={WAVE.x} y={WAVE.y} width={WAVE.w} height={WAVE.h} rx={6} fill="#1B1C22" />
        <line x1={WAVE.x} y1={WAVE.y + WAVE.h / 2} x2={WAVE.x + WAVE.w} y2={WAVE.y + WAVE.h / 2} stroke="#2E2F37" />
        {analysis && <path d={analysis.wavePath} stroke="#E6AD5E" strokeWidth={1} />}
        <text x={WAVE.x + 8} y={WAVE.y + 16} fill="#8A8A94" fontSize={10} fontFamily="monospace">
          IMPULSE
        </text>
        {analysis && (
          <text x={WAVE.x + WAVE.w - 8} y={WAVE.y + WAVE.h - 8} fill="#8A8A94" fontSize={10} fontFamily="monospace" textAnchor="end">
            {length}
          </text>
        )}

        {GRID_HZ.map((hz) => (
          <g key={hz}>
            <line x1={xForHz(hz)} y1={RESP_Y0} x2={xForHz(hz)} y2={RESP_Y1} stroke="#23242B" />
            <text x={xForHz(hz)} y={HEIGHT - 7} fill="#5A5B64" fontSize={10} fontFamily="monospace" textAnchor="middle">
              {hzLabel(hz)}
            </text>
          </g>
        ))}
        {curves?.gridDb.map((db) => (
          <g key={db}>
            <line x1={RESP_X0} y1={curves.yForDb(db)} x2={RESP_X1} y2={curves.yForDb(db)} stroke={db === 0 ? "#2E2F37" : "#1F2026"} />
            <text x={RESP_X0 - 6} y={curves.yForDb(db) + 3} fill="#5A5B64" fontSize={10} fontFamily="monospace" textAnchor="end">
              {db > 0 ? `+${db}` : db}
            </text>
          </g>
        ))}
        {curves ? (
          <>
            <path d={curves.raw} stroke="#9A9AA4" strokeWidth={1.5} strokeDasharray="4 4" strokeLinejoin="round" />
            <path d={curves.shaped} stroke="#E6AD5E" strokeWidth={2.5} strokeLinejoin="round" />
          </>
        ) : (
          <text x={(RESP_X0 + RESP_X1) / 2} y={HEIGHT / 2} fill="#8A8A94" fontSize={13} textAnchor="middle">
            {emptyMessage}
          </text>
        )}
      </svg>
    </div>
  );
}
