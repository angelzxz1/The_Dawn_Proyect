"use client";

import { useEffect, useRef, useState } from "react";
import { audioEngine } from "@/lib/audioEngine";
import { paramSpecs } from "@/lib/effects";
import type { MbdMeters } from "@/lib/mbDynamics";
import { MBD_BAND_LABELS, MBD_MIN_DB, formatMbdRatio, mbdBandFromParams, mbdKey, type MbdBand, type MbdField } from "@/lib/mbDynamicsModel";

/** Top to bottom, as the device shows them. */
export const MBD_ROWS: MbdBand[] = ["h", "m", "l"];
export const MBD_COLORS: Record<MbdBand, string> = { h: "#7DB7FF", m: "#6BD68B", l: "#E6AD5E" };
const MAX_DB = 0;
const EDGE_PX = 6;

const spec = (key: string) => paramSpecs("mbDynamics").find((s) => s.key === key)!;
const clamp = (key: string, v: number) => Math.max(spec(key).min, Math.min(spec(key).max, v));

/** Whether a band exists (the Low/High switches) - Mid always does. */
export function mbdBandExists(params: Record<string, number>, band: MbdBand): boolean {
  if (band === "l") return (params.lowOn ?? 1) >= 0.5;
  if (band === "h") return (params.highOn ?? 1) >= 0.5;
  return true;
}

/** Each band's input/output peaks, polled ~30x a second, falling back
 * at 45 dB/s between readings. */
export function useMbdMeters(hostId: string | undefined, effectId: string): MbdMeters {
  const [meters, setMeters] = useState<MbdMeters>({});
  useEffect(() => {
    if (!hostId) return;
    let frame = 0;
    let last = 0;
    const held: MbdMeters = {};
    const tick = (now: number) => {
      if (now - last > 33) {
        const dt = last ? (now - last) / 1000 : 0;
        last = now;
        const m = audioEngine.getMbDynamicsMeters(hostId, effectId) ?? {};
        (["l", "m", "h"] as MbdBand[]).forEach((b) => {
          const prev = held[b] ?? { input: -Infinity, output: -Infinity };
          const cur = m[b] ?? { input: -Infinity, output: -Infinity };
          held[b] = { input: Math.max(cur.input, prev.input - 45 * dt), output: Math.max(cur.output, prev.output - 45 * dt) };
        });
        setMeters({ ...held });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [hostId, effectId]);
  return meters;
}

type Target = { band: MbdBand; kind: "aboveT" | "belowT" | "aboveR" | "belowR" };

/** Live-style display: per band, a block under the Below threshold (left)
 * and over the Above threshold (right), with the band's output level (big
 * bar) and input level (thin bar). Drag a block's inner edge for its
 * threshold, inside it up or down for its ratio (up = louder). Ctrl/Cmd:
 * all bands. Alt: Above and Below together. Shift: finer. Double-click a
 * block to reset its ratio. */
export function MbDynamicsDisplay({
  params,
  meters,
  width,
  rowHeight,
  onParamChange,
  onDragStart,
  interactive = true,
}: {
  params: Record<string, number>;
  meters: MbdMeters;
  width: number;
  rowHeight: number;
  onParamChange?: (key: string, value: number) => void;
  onDragStart?: () => void;
  interactive?: boolean;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ target: Target; all: boolean; both: boolean; fine: boolean; x: number; y: number; start: Record<string, number> } | null>(null);
  const [cursor, setCursor] = useState("default");
  const axisH = interactive ? 20 : 0;
  const padL = 26;
  const padR = 8;
  const plotW = width - padL - padR;
  const height = rowHeight * 3 + axisH;
  const xOf = (db: number) => padL + ((Math.max(MBD_MIN_DB, Math.min(MAX_DB, db)) - MBD_MIN_DB) / (MAX_DB - MBD_MIN_DB)) * plotW;
  const pxPerDb = plotW / (MAX_DB - MBD_MIN_DB);

  const hit = (x: number, y: number): Target | null => {
    const row = Math.floor(y / rowHeight);
    const band = MBD_ROWS[row];
    if (!band || !mbdBandExists(params, band)) return null;
    const b = mbdBandFromParams(params, band);
    const xa = xOf(b.aboveT);
    const xb = xOf(b.belowT);
    if (Math.abs(x - xa) <= EDGE_PX) return { band, kind: "aboveT" };
    if (Math.abs(x - xb) <= EDGE_PX) return { band, kind: "belowT" };
    if (x > xa) return { band, kind: "aboveR" };
    if (x < xb && x > padL) return { band, kind: "belowR" };
    return null;
  };
  const local = (e: React.PointerEvent | React.MouseEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * width, y: ((e.clientY - r.top) / r.height) * height };
  };

  /** The keys a drag of `target` moves, with the modifiers. */
  const keysFor = (target: Target, all: boolean, both: boolean): string[] => {
    const bands = all ? MBD_ROWS.filter((b) => mbdBandExists(params, b)) : [target.band];
    const isT = target.kind.endsWith("T");
    const fields: MbdField[] = both ? (isT ? ["AboveT", "BelowT"] : ["AboveR", "BelowR"]) : [target.kind === "aboveT" ? "AboveT" : target.kind === "belowT" ? "BelowT" : target.kind === "aboveR" ? "AboveR" : "BelowR"];
    return bands.flatMap((b) => fields.map((f) => mbdKey(b, f)));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive || !onParamChange) return;
    const p = local(e);
    const target = hit(p.x, p.y);
    if (!target) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    onDragStart?.();
    const all = e.ctrlKey || e.metaKey;
    const both = e.altKey;
    const start: Record<string, number> = {};
    keysFor(target, all, both).forEach((k) => (start[k] = params[k] ?? spec(k).default));
    drag.current = { target, all, both, fine: e.shiftKey, x: p.x, y: p.y, start };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!interactive) return;
    const p = local(e);
    const d = drag.current;
    if (!d) {
      const t = hit(p.x, p.y);
      setCursor(!t ? "default" : t.kind.endsWith("T") ? "ew-resize" : "ns-resize");
      return;
    }
    const scale = e.shiftKey || d.fine ? 0.25 : 1;
    Object.entries(d.start).forEach(([key, start]) => {
      let v: number;
      if (key.endsWith("T")) {
        v = clamp(key, start + ((p.x - d.x) / pxPerDb) * scale);
        v = Math.round(v * 10) / 10;
      } else {
        // Down: a bigger ratio (quieter), up: smaller (louder).
        v = clamp(key, start * Math.exp((p.y - d.y) * 0.02 * scale));
        if (Math.abs(Math.log(v)) < 0.03) v = 1;
        v = Math.round(v * 100) / 100;
      }
      onParamChange?.(key, v);
    });
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!interactive || !onParamChange) return;
    const p = local(e);
    const t = hit(p.x, p.y);
    if (!t || t.kind.endsWith("T")) return;
    onDragStart?.();
    keysFor(t, e.ctrlKey || e.metaKey, e.altKey).forEach((k) => onParamChange(k, 1));
  };

  return (
    <svg
      ref={svg}
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Multiband dynamics display"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      style={{ display: "block", background: "#101115", borderRadius: 8, cursor, touchAction: "none", userSelect: "none" }}
    >
      {[-60, -40, -20].map((db) => (
        <line key={db} x1={xOf(db)} y1={0} x2={xOf(db)} y2={rowHeight * 3} stroke="#1D1E24" />
      ))}
      {MBD_ROWS.map((band, row) => {
        const y0 = row * rowHeight;
        const exists = mbdBandExists(params, band);
        const b = mbdBandFromParams(params, band);
        const color = MBD_COLORS[band];
        const live = exists && b.on;
        const m = meters[band];
        const blockH = (ratioLoud: number) => Math.max(0.25, Math.min(1, 0.62 * (1 + 0.35 * ratioLoud))) * (rowHeight - 8);
        // Louder (ratio < 1) draws a taller block, quieter a shorter one.
        const aboveH = blockH(-Math.log(b.aboveR));
        const belowH = blockH(-Math.log(b.belowR));
        const mid = y0 + rowHeight / 2;
        const xa = xOf(b.aboveT);
        const xb = xOf(b.belowT);
        const outW = m && Number.isFinite(m.output) ? xOf(m.output) - padL : 0;
        const inW = m && Number.isFinite(m.input) ? xOf(m.input) - padL : 0;
        const tint = (r: number) => (r > 1.001 ? "#2B3A55" : r < 0.999 ? "#553D22" : "#24252C");
        return (
          <g key={band} opacity={exists ? (live ? 1 : 0.45) : 0.18}>
            <rect x={0} y={y0 + 1} width={width} height={rowHeight - 2} fill={row % 2 ? "#14151A" : "#121317"} />
            <text x={8} y={mid + 4} fill={color} fontSize={11} fontWeight={700} fontFamily="monospace">
              {MBD_BAND_LABELS[band][0]}
            </text>
            {/* Below block (left) and Above block (right). */}
            <rect x={padL} y={mid - belowH / 2} width={Math.max(0, xb - padL)} height={belowH} fill={tint(b.belowR)} stroke="#3A3B44" />
            <rect x={xa} y={mid - aboveH / 2} width={Math.max(0, xOf(MAX_DB) - xa)} height={aboveH} fill={tint(b.aboveR)} stroke="#3A3B44" />
            {interactive && xb - padL > 34 && (
              <text x={padL + 6} y={y0 + 14} fill="#8A8A94" fontSize={10} fontFamily="monospace">
                {`B ${formatMbdRatio(b.belowR)}`}
              </text>
            )}
            {interactive && xOf(MAX_DB) - xa > 34 && (
              <text x={xOf(MAX_DB) - 6} y={y0 + 14} fill="#8A8A94" fontSize={10} fontFamily="monospace" textAnchor="end">
                {`A ${formatMbdRatio(b.aboveR)}`}
              </text>
            )}
            {/* Levels: output (big) and input (thin, on top). */}
            <rect x={padL} y={mid - rowHeight * 0.16} width={Math.max(0, outW)} height={rowHeight * 0.32} fill={color} opacity={0.75} rx={2} />
            <rect x={padL} y={mid - rowHeight * 0.16 - 3} width={Math.max(0, inW)} height={3} fill="#F4EDE2" opacity={0.85} />
            {/* Threshold edges. */}
            <line x1={xb} y1={y0 + 3} x2={xb} y2={y0 + rowHeight - 3} stroke={color} strokeWidth={2} />
            <line x1={xa} y1={y0 + 3} x2={xa} y2={y0 + rowHeight - 3} stroke={color} strokeWidth={2} />
          </g>
        );
      })}
      {interactive &&
        [-80, -70, -60, -50, -40, -30, -20, -10, 0].map((db) => (
          <text key={db} x={xOf(db)} y={rowHeight * 3 + 14} fill="#6A6B75" fontSize={10} fontFamily="monospace" textAnchor="middle">
            {db}
          </text>
        ))}
    </svg>
  );
}
