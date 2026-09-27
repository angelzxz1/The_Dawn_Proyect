"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { audioEngine } from "@/lib/audioEngine";
import {
  EQ_SHAPES,
  EQ_SHAPE_LABELS,
  designEqBand,
  eqBandsFromParams,
  eqSectionsDb,
  shapeUsesGain,
  type EqBand,
  type EqShape,
} from "@/lib/paramEqModel";

export const EQ_BAND_COLORS = ["#E6AD5E", "#5EB1FF", "#6BD68B", "#FF7AA8", "#B08CFF", "#FFD166", "#4FD1C5", "#FF8A5B"];
export const eqBandColor = (index: number) => EQ_BAND_COLORS[index % EQ_BAND_COLORS.length];

const F_MIN = 10;
const F_MAX = 22000;
const LOG_SPAN = Math.log(F_MAX / F_MIN);
const CURVE_POINTS = 300;
const CURVE_FREQS = Array.from({ length: CURVE_POINTS }, (_, i) => F_MIN * Math.exp((i / (CURVE_POINTS - 1)) * LOG_SPAN));
const GRID_HZ = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const SPECTRUM_POINTS = 220;
/** Analyzer display: tilt (dB/oct, pivoting at 1 kHz) so typical music
 * reads roughly flat, and the dB range mapped onto the graph's height. */
const SPECTRUM_TILT = 4.5;
const SPECTRUM_TOP_DB = -6;
const SPECTRUM_BOTTOM_DB = -96;
const Q_MIN = 0.025;
const Q_MAX = 40;
const NODE_R = 7;

export interface EqGeometry {
  width: number;
  height: number;
  scale: number;
}

const xForHz = (g: EqGeometry, hz: number) => (Math.log(hz / F_MIN) / LOG_SPAN) * g.width;
const hzForX = (g: EqGeometry, x: number) => Math.min(F_MAX, Math.max(F_MIN, F_MIN * Math.exp((x / g.width) * LOG_SPAN)));
const pad = (g: EqGeometry) => Math.max(10, g.height * 0.06);
const yForDb = (g: EqGeometry, db: number) => g.height / 2 - (db / g.scale) * (g.height / 2 - pad(g));
const dbForY = (g: EqGeometry, y: number) => ((g.height / 2 - y) / (g.height / 2 - pad(g))) * g.scale;

const shapeName = (b: EqBand): EqShape => EQ_SHAPES[b.shape] ?? "bell";
const isCut = (b: EqBand) => shapeName(b) === "lowCut" || shapeName(b) === "highCut";

/** Cut filters: the node sits at the curve's level at the cutoff, which Q
 * sets (-3 dB at Q 0.71), so dragging it up/down changes the resonance. */
const cutDbForQ = (q: number) => -3.01 + 20 * Math.log10(q / Math.SQRT1_2);
const qForCutDb = (db: number) => Math.SQRT1_2 * Math.pow(10, (db + 3.01) / 20);

function nodeDb(b: EqBand): number {
  if (shapeUsesGain(shapeName(b))) return b.gain;
  if (isCut(b)) return cutDbForQ(b.q);
  return 0;
}

export function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 1 : 2)} kHz` : `${hz.toFixed(hz < 100 ? 1 : 0)} Hz`;
}

function pathFor(g: EqGeometry, values: number[]): string {
  return `M${values.map((db, i) => `${xForHz(g, CURVE_FREQS[i]).toFixed(1)},${yForDb(g, Math.max(-g.scale * 1.5, Math.min(g.scale * 1.5, db))).toFixed(1)}`).join(" L")}`;
}

interface ParamEqGraphProps {
  params: Record<string, number>;
  width: number;
  height: number;
  /** A small, non-interactive preview (the FX rack card). */
  compact?: boolean;
  hostId?: string;
  effectId?: string;
  selected?: number | null;
  onSelect?: (band: number | null) => void;
  onBandChange?: (band: number, change: Partial<Pick<EqBand, "freq" | "gain" | "q">>) => void;
  onAddBand?: (shape: EqShape, freq: number, gain: number) => void;
  onToggleBypass?: (band: number) => void;
  onRemoveBand?: (band: number) => void;
  /** Once per gesture (drag, wheel burst), for one undo step. */
  onGestureStart?: () => void;
}

/** The EQ's graph: analyzer behind, every band's own curve in its colour,
 * the combined curve on top, and a draggable node per band. Double-click to
 * add a band; drag to move it (Shift for fine); scroll to change Q; Alt-click
 * to bypass; right-click to delete. */
export function ParamEqGraph({
  params,
  width,
  height,
  compact = false,
  hostId,
  effectId,
  selected = null,
  onSelect,
  onBandChange,
  onAddBand,
  onToggleBypass,
  onRemoveBand,
  onGestureStart,
}: ParamEqGraphProps) {
  const geometry = useMemo<EqGeometry>(() => ({ width, height, scale: params.scale ?? 12 }), [width, height, params.scale]);
  const svgRef = useRef<SVGSVGElement>(null);
  const prePath = useRef<SVGPathElement>(null);
  const postPath = useRef<SVGPathElement>(null);
  const drag = useRef<{ band: number; lastX: number; lastY: number; nodeX: number; nodeY: number } | null>(null);
  const wheelAt = useRef(0);
  const [hover, setHover] = useState<number | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const sampleRate = audioEngine.sampleRate;
  const bands = useMemo(() => eqBandsFromParams(params), [params]);
  const analyzer = compact ? 0 : Math.round(params.analyzer ?? 2);

  const curves = useMemo(() => {
    const total = CURVE_FREQS.map(() => 0);
    const perBand = bands.map((b, index) => {
      if (b.on !== 1) return null;
      const sections = designEqBand(b.shape, b.freq, b.gain, b.q, b.slope, sampleRate);
      const values = CURVE_FREQS.map((f, i) => {
        const v = eqSectionsDb(sections, f, sampleRate);
        total[i] += v;
        return v;
      });
      return { index, path: pathFor(geometry, values), values };
    });
    return { total: pathFor(geometry, total), perBand };
  }, [bands, geometry, sampleRate]);

  // Analyzer: redrawn every frame straight into the two paths.
  useEffect(() => {
    if (!analyzer || !hostId || !effectId) {
      prePath.current?.setAttribute("d", "");
      postPath.current?.setAttribute("d", "");
      return;
    }
    let frame: number;
    const toPath = (data: Float32Array | null) => {
      if (!data || !data.length) return "";
      const binHz = sampleRate / 2 / data.length;
      let d = `M0,${height}`;
      for (let p = 0; p < SPECTRUM_POINTS; p++) {
        const f0 = F_MIN * Math.exp((p / SPECTRUM_POINTS) * LOG_SPAN);
        const f1 = F_MIN * Math.exp(((p + 1) / SPECTRUM_POINTS) * LOG_SPAN);
        const from = Math.max(1, Math.floor(f0 / binHz));
        const to = Math.min(data.length - 1, Math.max(from, Math.ceil(f1 / binHz)));
        let peak = -Infinity;
        for (let k = from; k <= to; k++) if (data[k] > peak) peak = data[k];
        const fc = Math.sqrt(f0 * f1);
        const level = peak + SPECTRUM_TILT * Math.log2(fc / 1000);
        const t = Math.max(0, Math.min(1, (level - SPECTRUM_BOTTOM_DB) / (SPECTRUM_TOP_DB - SPECTRUM_BOTTOM_DB)));
        d += ` L${xForHz(geometry, fc).toFixed(1)},${(height - t * height).toFixed(1)}`;
      }
      return `${d} L${width},${height} Z`;
    };
    const draw = () => {
      prePath.current?.setAttribute("d", analyzer === 2 ? toPath(audioEngine.getEqSpectrum(hostId, effectId, "pre")) : "");
      postPath.current?.setAttribute("d", toPath(audioEngine.getEqSpectrum(hostId, effectId, "post")));
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [analyzer, hostId, effectId, geometry, height, width, sampleRate]);

  // Scroll: Q of the hovered band (else the selected one).
  const wheelState = useRef({ hover, selected, bands, onBandChange, onGestureStart });
  useEffect(() => {
    wheelState.current = { hover, selected, bands, onBandChange, onGestureStart };
  });
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || compact) return;
    const onWheel = (e: WheelEvent) => {
      const s = wheelState.current;
      const index = s.hover ?? s.selected;
      if (index === null || !s.bands[index] || s.bands[index].on === 0) return;
      e.preventDefault();
      const now = performance.now();
      if (now - wheelAt.current > 400) s.onGestureStart?.();
      wheelAt.current = now;
      const q = s.bands[index].q * Math.exp(-e.deltaY * (e.shiftKey ? 0.0004 : 0.002));
      s.onBandChange?.(index, { q: Math.min(Q_MAX, Math.max(Q_MIN, q)) });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [compact]);

  const toLocal = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * width, y: ((e.clientY - rect.top) / rect.height) * height };
  };

  const moveBand = (index: number, x: number, y: number) => {
    const b = bands[index];
    const freq = Math.round(hzForX(geometry, x) * 100) / 100;
    const db = dbForY(geometry, y);
    if (shapeUsesGain(shapeName(b))) onBandChange?.(index, { freq, gain: Math.max(-30, Math.min(30, Math.round(db * 100) / 100)) });
    else if (isCut(b)) onBandChange?.(index, { freq, q: Math.min(Q_MAX, Math.max(Q_MIN, qForCutDb(Math.min(24, db)))) });
    else onBandChange?.(index, { freq });
  };

  const nodes = bands
    .map((b, index) => ({ b, index }))
    .filter(({ b }) => b.on !== 0)
    .map(({ b, index }) => ({
      index,
      b,
      x: xForHz(geometry, b.freq),
      y: yForDb(geometry, Math.max(-geometry.scale, Math.min(geometry.scale, nodeDb(b)))),
    }));

  const gridDb = [geometry.scale, geometry.scale / 2, 0, -geometry.scale / 2, -geometry.scale];
  const hovered = hover !== null ? nodes.find((n) => n.index === hover) : null;

  return (
    <svg
      ref={svgRef}
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block", background: "#101115", borderRadius: compact ? 8 : 10, touchAction: "none", cursor: compact ? "pointer" : "crosshair" }}
      role="img"
      aria-label="Parametric EQ curve"
      onDoubleClick={(e) => {
        if (compact || !onAddBand) return;
        const { x, y } = toLocal(e);
        const freq = Math.round(hzForX(geometry, x));
        const shape: EqShape = freq < 30 ? "lowCut" : freq > 15000 ? "highCut" : "bell";
        onAddBand(shape, freq, shape === "bell" ? Math.max(-30, Math.min(30, Math.round(dbForY(geometry, y) * 10) / 10)) : 0);
      }}
      onPointerDown={(e) => {
        if (!compact && e.target === svgRef.current) onSelect?.(null);
      }}
      onPointerMove={(e) => {
        if (compact) return;
        const p = toLocal(e);
        setCursor(p);
        const d = drag.current;
        if (!d) return;
        const scale = e.shiftKey ? 0.15 : 1;
        d.nodeX = Math.max(0, Math.min(width, d.nodeX + (p.x - d.lastX) * scale));
        d.nodeY = Math.max(0, Math.min(height, d.nodeY + (p.y - d.lastY) * scale));
        d.lastX = p.x;
        d.lastY = p.y;
        moveBand(d.band, d.nodeX, d.nodeY);
      }}
      onPointerLeave={() => setCursor(null)}
      onPointerUp={() => {
        drag.current = null;
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Grid */}
      {GRID_HZ.map((hz) => (
        <line key={hz} x1={xForHz(geometry, hz)} y1={0} x2={xForHz(geometry, hz)} y2={height} stroke="#1D1E24" />
      ))}
      {gridDb.map((db) => (
        <line key={db} x1={0} y1={yForDb(geometry, db)} x2={width} y2={yForDb(geometry, db)} stroke={db === 0 ? "#2A2B33" : "#1D1E24"} />
      ))}

      {/* Analyzer */}
      <path ref={prePath} fill="#26272E" stroke="none" />
      <path ref={postPath} fill="rgba(94,177,255,0.10)" stroke="rgba(94,177,255,0.35)" strokeWidth={1} />

      {/* Axis labels, above the analyzer */}
      {!compact && (
        <g pointerEvents="none">
          {GRID_HZ.map((hz) => (
            <text key={hz} x={xForHz(geometry, hz) + 3} y={height - 6} fill="#6A6B75" fontSize={10} fontFamily="monospace">
              {hz >= 1000 ? `${hz / 1000}k` : hz}
            </text>
          ))}
          {gridDb
            .filter((db) => db !== 0)
            .map((db) => (
              <text key={db} x={width - 4} y={yForDb(geometry, db) - 3} fill="#6A6B75" fontSize={10} fontFamily="monospace" textAnchor="end">
                {db > 0 ? `+${db}` : db}
              </text>
            ))}
        </g>
      )}

      {/* Each band's own curve, then the total */}
      {curves.perBand.map(
        (c) =>
          c && (
            <path
              key={c.index}
              d={`${c.path} L${width},${yForDb(geometry, 0)} L0,${yForDb(geometry, 0)} Z`}
              fill={eqBandColor(c.index)}
              fillOpacity={selected === c.index || hover === c.index ? 0.22 : 0.08}
              stroke={eqBandColor(c.index)}
              strokeOpacity={selected === c.index || hover === c.index ? 0.8 : 0.3}
              strokeWidth={1}
            />
          )
      )}
      <path d={curves.total} stroke="#F4EDE2" strokeWidth={compact ? 1.5 : 2.5} fill="none" strokeLinejoin="round" />

      {/* Nodes */}
      {nodes.map(({ index, b, x, y }) => {
        const color = eqBandColor(index);
        const isSelected = selected === index;
        return (
          <g
            key={index}
            style={{ cursor: compact ? "pointer" : "grab" }}
            onPointerEnter={() => !compact && setHover(index)}
            onPointerLeave={() => !compact && setHover((h) => (h === index ? null : h))}
            onPointerDown={(e) => {
              if (compact) return;
              e.stopPropagation();
              if (e.button === 2) {
                onRemoveBand?.(index);
                return;
              }
              if (e.altKey) {
                onToggleBypass?.(index);
                return;
              }
              onSelect?.(index);
              onGestureStart?.();
              const p = toLocal(e);
              drag.current = { band: index, lastX: p.x, lastY: p.y, nodeX: x, nodeY: y };
              (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {!compact && <circle cx={x} cy={y} r={NODE_R + 8} fill="transparent" />}
            {isSelected && !compact && <circle cx={x} cy={y} r={NODE_R + 4} fill="none" stroke={color} strokeOpacity={0.5} strokeWidth={2} />}
            <circle
              cx={x}
              cy={y}
              r={compact ? 3.5 : NODE_R}
              fill={b.on === 2 ? "#101115" : color}
              stroke={b.on === 2 ? color : "#101115"}
              strokeWidth={compact ? 1 : 2}
            />
            {!compact && (
              <text x={x} y={y + 3.5} fill={b.on === 2 ? color : "#101115"} fontSize={9.5} fontWeight={700} textAnchor="middle" pointerEvents="none">
                {index + 1}
              </text>
            )}
          </g>
        );
      })}

      {/* Hover tooltip and cursor readout */}
      {!compact && hovered && (
        <g pointerEvents="none">
          <rect
            x={Math.min(width - 190, hovered.x + 14)}
            y={Math.max(4, hovered.y - 40)}
            width={180}
            height={34}
            rx={6}
            fill="#1B1C22"
            stroke={eqBandColor(hovered.index)}
            strokeOpacity={0.6}
          />
          <text x={Math.min(width - 190, hovered.x + 14) + 10} y={Math.max(4, hovered.y - 40) + 14} fill="#F4EDE2" fontSize={11} fontFamily="monospace">
            {`${hovered.index + 1} · ${EQ_SHAPE_LABELS[shapeName(hovered.b)]}${hovered.b.on === 2 ? " (off)" : ""}`}
          </text>
          <text x={Math.min(width - 190, hovered.x + 14) + 10} y={Math.max(4, hovered.y - 40) + 27} fill="#9A9AA4" fontSize={11} fontFamily="monospace">
            {`${formatHz(hovered.b.freq)}${shapeUsesGain(shapeName(hovered.b)) ? ` · ${hovered.b.gain > 0 ? "+" : ""}${hovered.b.gain.toFixed(1)} dB` : ""} · Q ${hovered.b.q.toFixed(2)}`}
          </text>
        </g>
      )}
      {!compact && cursor && !hovered && (
        <text x={8} y={16} fill="#5A5B64" fontSize={11} fontFamily="monospace" pointerEvents="none">
          {`${formatHz(hzForX(geometry, cursor.x))}  ${dbForY(geometry, cursor.y) > 0 ? "+" : ""}${dbForY(geometry, cursor.y).toFixed(1)} dB`}
        </text>
      )}
      {!compact && nodes.length === 0 && (
        <text x={width / 2} y={height / 2 - 12} fill="#5A5B64" fontSize={13} textAnchor="middle" pointerEvents="none">
          Double-click anywhere to add a band
        </text>
      )}
    </svg>
  );
}
