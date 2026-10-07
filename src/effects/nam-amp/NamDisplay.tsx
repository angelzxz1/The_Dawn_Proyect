"use client";

import { useEffect, useMemo, useRef } from "react";
import { audioEngine } from "@/lib/audioEngine";
import { filterResponseDb } from "@/effects/filter/filterModel";
import { toneStackStages } from "./namModel";
import type { NamModelState } from "./NamFileSlot";
import { fraunces } from "@/effects/ui/pluginFonts";

interface NamDisplayProps {
  hostId: string;
  effectId: string;
  model: NamModelState;
  fileName: string | undefined;
  bass: number;
  middle: number;
  treble: number;
  /** Gain applied by Normalize, or null when it isn't (off, or no loudness). */
  normalizeDb: number | null;
}

const CURVE_W = 420;
const CURVE_H = 120;
const CURVE_RANGE_DB = 20;
const CURVE_POINTS = 160;
const CURVE_FREQS = Array.from({ length: CURVE_POINTS }, (_, i) => 20 * Math.pow(1000, i / (CURVE_POINTS - 1)));
const CURVE_GRID_HZ = [100, 1000, 10000];
const METER_MIN_DB = -60;
const METER_FALL_DB_PER_S = 30;

const xForHz = (hz: number) => (Math.log(hz / 20) / Math.log(1000)) * CURVE_W;
const yForDb = (db: number) =>
  CURVE_H / 2 - (Math.max(-CURVE_RANGE_DB, Math.min(CURVE_RANGE_DB, db)) / CURVE_RANGE_DB) * (CURVE_H / 2 - 6);

function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "accent" | "warn" }) {
  const colors = {
    default: { background: "#23242B", color: "#9A9AA4" },
    accent: { background: "rgba(230,173,94,0.15)", color: "#E6AD5E" },
    warn: { background: "rgba(255,122,122,0.12)", color: "#FF9A7A" },
  }[tone];
  return (
    <span className="rounded px-1.5 py-0.5 font-mono text-[10.5px] font-semibold" style={colors}>
      {children}
    </span>
  );
}

/** The amp window's display: which model is loaded (and what it says about
 * itself), the tone stack's curve, and the level going into the model. */
export function NamDisplay({ hostId, effectId, model, fileName, bass, middle, treble, normalizeDb }: NamDisplayProps) {
  const meterFill = useRef<HTMLDivElement>(null);
  const meterText = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let frame: number;
    let last = performance.now();
    let shown = -Infinity;
    let lastText = "";
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const level = audioEngine.getNamInputLevel(hostId, effectId) ?? -Infinity;
      shown = level >= shown || !Number.isFinite(shown) ? level : Math.max(level, shown - METER_FALL_DB_PER_S * dt);
      const fraction = Number.isFinite(shown) ? Math.max(0, Math.min(1, (shown - METER_MIN_DB) / -METER_MIN_DB)) : 0;
      if (meterFill.current) {
        meterFill.current.style.width = `${(fraction * 100).toFixed(2)}%`;
        meterFill.current.style.background = shown > -3 ? "#FF7A7A" : "#E6AD5E";
      }
      const text = Number.isFinite(shown) && shown > METER_MIN_DB ? `${shown.toFixed(1)} dB` : "—";
      if (text !== lastText && meterText.current) {
        meterText.current.textContent = text;
        lastText = text;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [hostId, effectId]);

  const curve = useMemo(() => {
    const stages = toneStackStages(bass, middle, treble);
    const sampleRate = audioEngine.sampleRate;
    return `M${CURVE_FREQS.map((f) => `${xForHz(f).toFixed(1)},${yForDb(filterResponseDb(stages, 1, f, sampleRate)).toFixed(1)}`).join(" L")}`;
  }, [bass, middle, treble]);

  const info = model.status === "ready" ? model.info : null;
  const sampleRate = audioEngine.sampleRate;
  const rateMismatch = info?.sampleRate && Math.abs(info.sampleRate - sampleRate) > 1;
  const title =
    model.status === "empty"
      ? "No model loaded"
      : model.status === "missing"
        ? "Model file missing"
        : (info?.title ?? fileName?.replace(/\.nam$/i, "") ?? "Loading…");

  return (
    <div className="flex flex-col gap-3 rounded-[10px] p-4" style={{ background: "#14151A", border: "1px solid #2E2F37" }}>
      <div className="flex gap-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#5A5B64" }}>
            Model
          </span>
          <h3
            className={`${fraunces.className} truncate text-[22px] font-semibold leading-tight`}
            style={{ color: model.status === "missing" ? "#FF7A7A" : "#F4EDE2" }}
            title={title}
          >
            {title}
          </h3>
          {model.status === "empty" && (
            <p className="text-[12px]" style={{ color: "#8A8A94" }}>
              Load a .nam capture to hear it. With no model, audio passes straight through.
            </p>
          )}
          {model.status === "missing" && (
            <p className="text-[12px]" style={{ color: "#8A8A94" }}>
              &ldquo;{fileName}&rdquo; isn&apos;t in this browser any more - load it again.
            </p>
          )}
          {info && (
            <>
              {(info.subtitle || info.modeledBy) && (
                <p className="truncate text-[12px]" style={{ color: "#9A9AA4" }}>
                  {[info.subtitle, info.modeledBy ? `captured by ${info.modeledBy}` : null].filter(Boolean).join(" — ")}
                </p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge tone={info.isA2 ? "accent" : "default"}>{info.architecture}</Badge>
                {info.sampleRate && <Badge>{+(info.sampleRate / 1000).toFixed(1)} kHz</Badge>}
                {normalizeDb !== null ? (
                  <Badge>
                    Normalized {normalizeDb >= 0 ? "+" : ""}
                    {normalizeDb.toFixed(1)} dB
                  </Badge>
                ) : info.loudness === null ? (
                  <Badge>No loudness info</Badge>
                ) : null}
              </div>
              {rateMismatch && (
                <p className="mt-1 text-[11px] leading-snug" style={{ color: "#FF9A7A" }}>
                  Trained at {+(info.sampleRate! / 1000).toFixed(1)} kHz but audio is running at {+(sampleRate / 1000).toFixed(1)} kHz
                  here, so it will sound a little different from the real capture.
                </p>
              )}
            </>
          )}
        </div>

        <div className="shrink-0">
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#5A5B64" }}>
            Tone stack
          </span>
          <svg width={CURVE_W} height={CURVE_H} viewBox={`0 0 ${CURVE_W} ${CURVE_H}`} fill="none" role="img" aria-label="Tone stack response" className="mt-1 block rounded-md" style={{ background: "#1B1C22" }}>
            {CURVE_GRID_HZ.map((hz) => (
              <line key={hz} x1={xForHz(hz)} y1={0} x2={xForHz(hz)} y2={CURVE_H} stroke="#23242B" />
            ))}
            {[10, -10].map((db) => (
              <g key={db}>
                <line x1={0} y1={yForDb(db)} x2={CURVE_W} y2={yForDb(db)} stroke="#23242B" strokeDasharray="3 4" />
                <text x={CURVE_W - 4} y={yForDb(db) - 3} fill="#5A5B64" fontSize={10} fontFamily="monospace" textAnchor="end">
                  {db > 0 ? `+${db}` : db} dB
                </text>
              </g>
            ))}
            <line x1={0} y1={CURVE_H / 2} x2={CURVE_W} y2={CURVE_H / 2} stroke="#2E2F37" />
            <path d={curve} stroke="#E6AD5E" strokeWidth={2.5} strokeLinejoin="round" />
            {CURVE_GRID_HZ.map((hz) => (
              <text key={hz} x={xForHz(hz) + 4} y={CURVE_H - 6} fill="#5A5B64" fontSize={10} fontFamily="monospace">
                {hz >= 1000 ? `${hz / 1000}k` : hz}
              </text>
            ))}
          </svg>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="w-12 text-[10px] font-bold uppercase tracking-widest" style={{ color: "#5A5B64" }}>
          Input
        </span>
        <div className="relative h-2 flex-1 overflow-hidden rounded-full" style={{ background: "#23242B" }}>
          <div ref={meterFill} className="absolute inset-y-0 left-0 rounded-full" style={{ width: 0 }} />
        </div>
        <span ref={meterText} className="w-16 text-right font-mono text-[11px]" style={{ color: "#9A9AA4" }}>
          —
        </span>
      </div>
    </div>
  );
}
