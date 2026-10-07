"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { audioEngine } from "@/engine/audioEngine";
import {
  MB_MAX_BANDS,
  MB_MAX_FREQ,
  MB_MIN_FREQ,
  MB_MODES,
  MB_MODE_LABELS,
  mbBandCount,
  mbBandFromParams,
  mbBandResponses,
  mbCrossoverLimits,
  mbCrossovers,
  mbTotalDb,
} from "./multibandModel";
import { eqBandColor, formatHz } from "@/effects/parametric-eq/ParamEqGraph";
import { spectrumPath } from "@/effects/ui/spectrumPath";

const LOG_SPAN = Math.log(MB_MAX_FREQ / MB_MIN_FREQ);
const CURVE_POINTS = 300;
const CURVE_FREQS = Array.from({ length: CURVE_POINTS }, (_, i) => MB_MIN_FREQ * Math.exp((i / (CURVE_POINTS - 1)) * LOG_SPAN));
const GRID_HZ = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const HANDLE_R = 8;
/** Height of the strip along the top holding the crossover handles. */
const TOP = 22;

export const mbBandColor = eqBandColor;

interface Geometry {
  width: number;
  height: number;
  scale: number;
}

const xForHz = (g: Geometry, hz: number) => (Math.log(hz / MB_MIN_FREQ) / LOG_SPAN) * g.width;
const hzForX = (g: Geometry, x: number) => Math.min(MB_MAX_FREQ, Math.max(MB_MIN_FREQ, MB_MIN_FREQ * Math.exp((x / g.width) * LOG_SPAN)));
const mid = (g: Geometry) => TOP + (g.height - TOP) / 2;
const half = (g: Geometry) => (g.height - TOP) / 2 - 12;
const yForDb = (g: Geometry, db: number) => mid(g) - (Math.max(-g.scale * 1.2, Math.min(g.scale * 1.2, db)) / g.scale) * half(g);
const dbForY = (g: Geometry, y: number) => ((mid(g) - y) / half(g)) * g.scale;

/** A curve (dB per CURVE_FREQS point) as path points. */
const points = (g: Geometry, values: ArrayLike<number>, from = 0, to = CURVE_POINTS - 1) => {
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(`${xForHz(g, CURVE_FREQS[i]).toFixed(1)},${yForDb(g, values[i]).toFixed(1)}`);
  return out;
};

interface MultibandGraphProps {
  params: Record<string, number>;
  width: number;
  height: number;
  /** A small, non-interactive preview (the FX rack card). */
  compact?: boolean;
  hostId?: string;
  effectId?: string;
  selected?: number;
  onSelect?: (band: number) => void;
  onCrossoverChange?: (index: number, freq: number) => void;
  onBandGainChange?: (band: number, gain: number) => void;
  onThresholdNudge?: (band: number, deltaDb: number) => void;
  onSplit?: (freq: number) => void;
  onRemoveCrossover?: (index: number) => void;
  onToggleBypass?: (band: number) => void;
  /** Once per gesture (drag, wheel burst), for one undo step. */
  onGestureStart?: () => void;
}

/** The multiband's graph: the spectrum behind, a tinted region per band,
 * the crossovers as draggable lines, and the gain curve - dashed where the
 * bands' makeup puts it, solid where the dynamics are moving it right now,
 * with the difference filled in the band's colour. Drag a crossover to move
 * it (right-click or double-click it to remove it), double-click empty
 * space to split a band there, drag a band's handle up/down for its gain,
 * scroll over a band to move its threshold, Alt-click to bypass it. */
export function MultibandGraph({
  params,
  width,
  height,
  compact = false,
  hostId,
  effectId,
  selected = 0,
  onSelect,
  onCrossoverChange,
  onBandGainChange,
  onThresholdNudge,
  onSplit,
  onRemoveCrossover,
  onToggleBypass,
  onGestureStart,
}: MultibandGraphProps) {
  const g = useMemo<Geometry>(() => ({ width, height, scale: compact ? 18 : (params.scale ?? 24) }), [width, height, compact, params.scale]);
  const svgRef = useRef<SVGSVGElement>(null);
  const prePath = useRef<SVGPathElement>(null);
  const postPath = useRef<SVGPathElement>(null);
  const livePath = useRef<SVGPathElement>(null);
  const fillPaths = useRef<(SVGPathElement | null)[]>([]);
  const drag = useRef<{ kind: "crossover" | "band"; index: number; lastX: number; lastY: number; value: number } | null>(null);
  const wheelAt = useRef(0);
  const [hoverBand, setHoverBand] = useState<number | null>(null);
  const [hoverCross, setHoverCross] = useState<number | null>(null);
  const [dragCross, setDragCross] = useState<number | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const sampleRate = audioEngine.sampleRate;
  const analyzer = compact ? 0 : Math.round(params.analyzer ?? 2);

  const count = mbBandCount(params);
  const crossKey = mbCrossovers(params).join(",");
  const crossovers = useMemo(() => (crossKey ? crossKey.split(",").map(Number) : []), [crossKey]);
  const bands = useMemo(() => Array.from({ length: count }, (_, b) => mbBandFromParams(params, b)), [params, count]);
  const makeups = useMemo(() => bands.map((b) => (b.bypass >= 0.5 ? 0 : b.gain)), [bands]);
  const responses = useMemo(() => mbBandResponses(crossovers, CURVE_FREQS, sampleRate), [crossovers, sampleRate]);
  const staticDb = useMemo(() => mbTotalDb(responses, makeups, new Float64Array(CURVE_POINTS)), [responses, makeups]);
  /** Each band's slice of the curve (point indexes), for its fill. */
  const slices = useMemo(() => {
    const edges = [MB_MIN_FREQ, ...crossovers, MB_MAX_FREQ];
    return Array.from({ length: count }, (_, b) => {
      const from = CURVE_FREQS.findIndex((f) => f >= edges[b]);
      let to = CURVE_FREQS.findIndex((f) => f > edges[b + 1]);
      to = to === -1 ? CURVE_POINTS - 1 : Math.max(from, to - 1);
      return { from: Math.max(0, from), to };
    });
  }, [crossovers, count]);
  const edges = [MB_MIN_FREQ, ...crossovers, MB_MAX_FREQ];
  const center = (b: number) => Math.sqrt(edges[b] * edges[b + 1]);

  // Live: the analyzer and the dynamics, redrawn every frame straight into
  // their paths (no React render per frame).
  const live = useRef({ staticDb, makeups, slices, responses, count });
  useEffect(() => {
    live.current = { staticDb, makeups, slices, responses, count };
  });
  useEffect(() => {
    let frame: number;
    const shown = new Float64Array(MB_MAX_BANDS);
    const liveDb = new Float64Array(CURVE_POINTS);
    const draw = () => {
      const s = live.current;
      if (analyzer && hostId && effectId) {
        prePath.current?.setAttribute("d", analyzer === 2 ? spectrumPath(audioEngine.getSpectrum(hostId, effectId, "pre"), sampleRate, width, height, MB_MIN_FREQ, MB_MAX_FREQ) : "");
        postPath.current?.setAttribute("d", spectrumPath(audioEngine.getSpectrum(hostId, effectId, "post"), sampleRate, width, height, MB_MIN_FREQ, MB_MAX_FREQ));
      } else {
        prePath.current?.setAttribute("d", "");
        postPath.current?.setAttribute("d", "");
      }
      const meters = hostId && effectId ? audioEngine.getMultibandMeters(hostId, effectId) : null;
      for (let b = 0; b < MB_MAX_BANDS; b++) {
        const target = meters?.gainDb[b] ?? 0;
        shown[b] += (target - shown[b]) * (Math.abs(target) > Math.abs(shown[b]) ? 0.6 : 0.25);
      }
      mbTotalDb(s.responses, s.makeups.map((m, b) => m + shown[b]), liveDb);
      livePath.current?.setAttribute("d", `M${points(g, liveDb).join(" L")}`);
      for (let b = 0; b < MB_MAX_BANDS; b++) {
        const el = fillPaths.current[b];
        if (!el) continue;
        const slice = s.slices[b];
        if (!slice || b >= s.count || Math.abs(shown[b]) < 0.05) {
          el.setAttribute("d", "");
          continue;
        }
        const top = points(g, liveDb, slice.from, slice.to);
        const bottom = points(g, s.staticDb, slice.from, slice.to).reverse();
        el.setAttribute("d", `M${top.join(" L")} L${bottom.join(" L")} Z`);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [analyzer, hostId, effectId, g, height, width, sampleRate]);

  // Scroll: the threshold of the band under the cursor.
  const wheelState = useRef({ hoverBand, onThresholdNudge, onGestureStart });
  useEffect(() => {
    wheelState.current = { hoverBand, onThresholdNudge, onGestureStart };
  });
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || compact) return;
    const onWheel = (e: WheelEvent) => {
      const s = wheelState.current;
      if (s.hoverBand === null) return;
      e.preventDefault();
      const now = performance.now();
      if (now - wheelAt.current > 400) s.onGestureStart?.();
      wheelAt.current = now;
      s.onThresholdNudge?.(s.hoverBand, -e.deltaY * (e.shiftKey ? 0.002 : 0.01));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [compact]);

  const toLocal = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * width, y: ((e.clientY - rect.top) / rect.height) * height };
  };
  const bandAtX = (x: number) => {
    const f = hzForX(g, x);
    const i = crossovers.findIndex((c) => f < c);
    return i === -1 ? count - 1 : i;
  };

  const gridDb = [g.scale, g.scale / 2, 0, -g.scale / 2, -g.scale];
  const zeroY = yForDb(g, 0);

  return (
    <svg
      ref={svgRef}
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block", background: "#101115", borderRadius: compact ? 8 : 10, touchAction: "none", cursor: compact ? "pointer" : "crosshair" }}
      role="img"
      aria-label="Multiband compressor bands"
      onDoubleClick={(e) => {
        if (compact) return;
        onSplit?.(Math.round(hzForX(g, toLocal(e).x)));
      }}
      onPointerDown={(e) => {
        if (compact || e.button !== 0) return;
        onSelect?.(bandAtX(toLocal(e).x));
      }}
      onPointerMove={(e) => {
        if (compact) return;
        const p = toLocal(e);
        setCursor(p);
        setHoverBand(bandAtX(p.x));
        const d = drag.current;
        if (!d) return;
        const fine = e.shiftKey ? 0.15 : 1;
        if (d.kind === "crossover") {
          const [lo, hi] = mbCrossoverLimits(params, d.index);
          const x = xForHz(g, d.value) + (p.x - d.lastX) * fine;
          d.value = Math.min(hi, Math.max(lo, hzForX(g, x)));
          onCrossoverChange?.(d.index, Math.round(d.value));
        } else {
          d.value = Math.max(-24, Math.min(24, d.value + (dbForY(g, p.y) - dbForY(g, d.lastY)) * fine));
          onBandGainChange?.(d.index, Math.round(d.value * 10) / 10);
        }
        d.lastX = p.x;
        d.lastY = p.y;
      }}
      onPointerLeave={() => {
        setCursor(null);
        setHoverBand(null);
      }}
      onPointerUp={() => {
        drag.current = null;
        setDragCross(null);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Band regions */}
      {bands.map((b, i) => (
        <rect
          key={i}
          x={xForHz(g, edges[i])}
          y={0}
          width={xForHz(g, edges[i + 1]) - xForHz(g, edges[i])}
          height={height}
          fill={mbBandColor(i)}
          fillOpacity={b.bypass >= 0.5 ? 0.015 : !compact && selected === i ? 0.1 : hoverBand === i ? 0.06 : 0.035}
        />
      ))}

      {/* Grid */}
      {GRID_HZ.map((hz) => (
        <line key={hz} x1={xForHz(g, hz)} y1={TOP} x2={xForHz(g, hz)} y2={height} stroke="#1D1E24" />
      ))}
      {gridDb.map((db) => (
        <line key={db} x1={0} y1={yForDb(g, db)} x2={width} y2={yForDb(g, db)} stroke={db === 0 ? "#2A2B33" : "#1D1E24"} />
      ))}

      {/* Analyzer */}
      <path ref={prePath} fill="#26272E" fillOpacity={0.8} stroke="none" />
      <path ref={postPath} fill="rgba(94,177,255,0.10)" stroke="rgba(94,177,255,0.35)" strokeWidth={1} />

      {!compact && (
        <g pointerEvents="none">
          {GRID_HZ.map((hz) => (
            <text key={hz} x={xForHz(g, hz) + 3} y={height - 6} fill="#6A6B75" fontSize={10} fontFamily="monospace">
              {hz >= 1000 ? `${hz / 1000}k` : hz}
            </text>
          ))}
          {gridDb
            .filter((db) => db !== 0)
            .map((db) => (
              <text key={db} x={width - 4} y={yForDb(g, db) - 3} fill="#6A6B75" fontSize={10} fontFamily="monospace" textAnchor="end">
                {db > 0 ? `+${db}` : db}
              </text>
            ))}
        </g>
      )}

      {/* Gain: live dynamics filled per band, the makeup curve dashed, the
          live curve solid */}
      {Array.from({ length: MB_MAX_BANDS }, (_, i) => (
        <path
          key={i}
          ref={(el) => {
            fillPaths.current[i] = el;
          }}
          fill={mbBandColor(i)}
          fillOpacity={0.45}
          stroke="none"
          pointerEvents="none"
        />
      ))}
      <path d={`M${points(g, staticDb).join(" L")}`} stroke="#F4EDE2" strokeOpacity={0.45} strokeDasharray="4 4" strokeWidth={1.2} fill="none" pointerEvents="none" />
      <path ref={livePath} stroke="#F4EDE2" strokeWidth={compact ? 1.5 : 2.5} fill="none" strokeLinejoin="round" pointerEvents="none" />

      {/* Per-band settings, along the top of each region */}
      {!compact &&
        bands.map((b, i) => {
          const x0 = xForHz(g, edges[i]);
          const w = xForHz(g, edges[i + 1]) - x0;
          const mode = MB_MODES[Math.round(b.mode)] ?? "compress";
          return (
            <text key={i} x={x0 + w / 2} y={TOP + 16} fill={mbBandColor(i)} fillOpacity={b.bypass >= 0.5 ? 0.4 : 0.9} fontSize={10.5} fontFamily="monospace" textAnchor="middle" pointerEvents="none">
              {w < 70 ? `${Math.round(b.thresh)}` : `${b.thresh.toFixed(1)} dB · ${b.ratio.toFixed(1)}:1${mode === "compress" ? "" : ` ${MB_MODE_LABELS[mode].slice(0, 3)}`}`}
            </text>
          );
        })}

      {/* Crossovers */}
      {crossovers.map((f, k) => {
        const x = xForHz(g, f);
        const active = hoverCross === k || dragCross === k;
        return (
          <g
            key={k}
            style={{ cursor: compact ? "pointer" : "ew-resize" }}
            onPointerEnter={() => !compact && setHoverCross(k)}
            onPointerLeave={() => !compact && setHoverCross((h) => (h === k ? null : h))}
            onPointerDown={(e) => {
              if (compact) return;
              e.stopPropagation();
              if (e.button === 2) {
                onRemoveCrossover?.(k);
                return;
              }
              onGestureStart?.();
              const p = toLocal(e);
              drag.current = { kind: "crossover", index: k, lastX: p.x, lastY: p.y, value: f };
              setDragCross(k);
              (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (!compact) onRemoveCrossover?.(k);
            }}
          >
            {!compact && <rect x={x - 6} y={0} width={12} height={height} fill="transparent" />}
            <line x1={x} y1={compact ? 0 : TOP} x2={x} y2={height} stroke={active ? "#F4EDE2" : "#5A5B64"} strokeWidth={active ? 1.5 : 1} />
            {!compact && (
              <>
                <rect x={x - 30} y={3} width={60} height={16} rx={8} fill={active ? "#F4EDE2" : "#2E2F37"} />
                <text x={x} y={14.5} fill={active ? "#101115" : "#C9C4BA"} fontSize={10} fontWeight={700} fontFamily="monospace" textAnchor="middle" pointerEvents="none">
                  {formatHz(f).replace(" ", "")}
                </text>
              </>
            )}
          </g>
        );
      })}

      {/* Band handles */}
      {bands.map((b, i) => {
        const x = xForHz(g, center(i));
        const y = yForDb(g, b.gain);
        const color = mbBandColor(i);
        const off = b.bypass >= 0.5;
        return (
          <g
            key={i}
            style={{ cursor: compact ? "pointer" : "ns-resize" }}
            onPointerDown={(e) => {
              if (compact) return;
              e.stopPropagation();
              if (e.button !== 0) return;
              if (e.altKey) {
                onToggleBypass?.(i);
                return;
              }
              onSelect?.(i);
              onGestureStart?.();
              const p = toLocal(e);
              drag.current = { kind: "band", index: i, lastX: p.x, lastY: p.y, value: b.gain };
              (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {!compact && <circle cx={x} cy={y} r={HANDLE_R + 7} fill="transparent" />}
            {!compact && selected === i && <circle cx={x} cy={y} r={HANDLE_R + 4} fill="none" stroke={color} strokeOpacity={0.5} strokeWidth={2} />}
            <circle cx={x} cy={y} r={compact ? 3.5 : HANDLE_R} fill={off ? "#101115" : color} stroke={off ? color : "#101115"} strokeWidth={compact ? 1 : 2} />
            {!compact && (
              <text x={x} y={y + 3.5} fill={off ? color : "#101115"} fontSize={9.5} fontWeight={700} textAnchor="middle" pointerEvents="none">
                {i + 1}
              </text>
            )}
          </g>
        );
      })}

      {!compact && cursor && (
        <text x={8} y={height - 22} fill="#5A5B64" fontSize={11} fontFamily="monospace" pointerEvents="none">
          {`${formatHz(hzForX(g, cursor.x))}  ${dbForY(g, cursor.y) > 0 ? "+" : ""}${dbForY(g, cursor.y).toFixed(1)} dB`}
        </text>
      )}
      {compact && <line x1={0} y1={zeroY} x2={width} y2={zeroY} stroke="#2A2B33" pointerEvents="none" />}
    </svg>
  );
}
