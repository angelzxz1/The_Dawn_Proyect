"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cachedWaveform, loadWaveform, waveformFromPeaks, waveformSpan, type Waveform } from "@/engine/waveform";

/** Canvas tiles this wide (px); only those on screen are drawn, so a long
 * clip zoomed in never needs one giant canvas. */
const TILE = 1024;

export interface WaveformView {
  pxPerSecond: number;
  /** Where in the source the clip starts (s). */
  sourceOffset: number;
  /** When set, the [sourceOffset, sourceOffset + loopLength) region
   * repeats. */
  loopLength?: number | null;
  /** The clip's length on the timeline (s). */
  length: number;
  /** Linear gain applied to the drawing (the clip's gain). */
  gain?: number;
  fadeIn?: number;
  fadeOut?: number;
  color: string;
}

/** The waveform of a source by URL: the full-resolution one once decoded,
 * the coarse saved peaks until then. */
export function useWaveform(url: string | undefined, peaks?: number[], durationSeconds?: number): Waveform | null {
  const [loaded, setLoaded] = useState<{ url: string; wf: Waveform } | null>(null);
  useEffect(() => {
    if (!url || cachedWaveform(url)) return;
    let alive = true;
    void loadWaveform(url).then((wf) => {
      if (alive && wf) setLoaded({ url, wf });
    });
    return () => {
      alive = false;
    };
  }, [url]);
  const cached = url ? cachedWaveform(url) : null;
  if (cached) return cached;
  if (loaded && loaded.url === url) return loaded.wf;
  return peaks && durationSeconds ? waveformFromPeaks(peaks, durationSeconds) : null;
}

/** Draws columns [x0, x0 + w) of a clip's waveform into `canvas`: each
 * pixel column is the min-to-max span of the audio under it, mirrored
 * around the middle like a DAW, scaled by the clip's gain and fades. */
function drawTile(canvas: HTMLCanvasElement, wf: Waveform, x0: number, w: number, h: number, view: WaveformView): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.ceil(w * dpr);
  canvas.height = Math.ceil(h * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  const mid = h / 2;
  const half = h / 2 - 1;
  ctx.fillStyle = view.color;
  ctx.globalAlpha = 0.3;
  ctx.fillRect(0, Math.round(mid), w, 1);
  ctx.globalAlpha = 0.95;
  const pps = view.pxPerSecond;
  const gain = view.gain ?? 1;
  const fadeIn = view.fadeIn ?? 0;
  const fadeOut = view.fadeOut ?? 0;
  const loop = view.loopLength && view.loopLength > 0 ? view.loopLength : null;
  for (let px = 0; px < w; px++) {
    const t0 = (x0 + px) / pps;
    if (t0 >= view.length) break;
    const t1 = Math.min(view.length, (x0 + px + 1) / pps);
    const s0 = view.sourceOffset + (loop ? t0 % loop : t0);
    const s1 = s0 + (t1 - t0);
    const span = waveformSpan(wf, s0, s1);
    if (!span) continue;
    let env = gain;
    if (fadeIn > 0 && t0 < fadeIn) env *= t0 / fadeIn;
    if (fadeOut > 0 && t0 > view.length - fadeOut) env *= Math.max(0, (view.length - t0) / fadeOut);
    const top = Math.max(0, mid - span[1] * env * half);
    const bottom = Math.min(h, mid - span[0] * env * half);
    ctx.fillRect(px, top, 1, Math.max(1, bottom - top));
  }
}

/** `version` marks in-place changes to the waveform (a recording in
 * progress), so the tile redraws. */
function Tile({ x, w, h, draw, version }: { x: number; w: number; h: number; draw: (canvas: HTMLCanvasElement, x0: number, w: number) => void; version: number }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "0px 600px" });
    io.observe(box);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (visible && canvasRef.current) draw(canvasRef.current, x, w);
  }, [visible, draw, x, w, version]);
  return (
    <div ref={boxRef} className="absolute top-0" style={{ left: x, width: w, height: h }}>
      {visible && <canvas ref={canvasRef} style={{ width: w, height: h, display: "block" }} />}
    </div>
  );
}

/** A clip's waveform, `width` x `height` px. `version` forces a redraw of
 * a waveform that changes in place (a recording in progress). */
export function WaveformCanvas({
  waveform,
  width,
  height,
  view,
  version = 0,
}: {
  waveform: Waveform | null;
  width: number;
  height: number;
  view: WaveformView;
  version?: number;
}) {
  const { pxPerSecond, sourceOffset, loopLength, length, gain, fadeIn, fadeOut, color } = view;
  const draw = useCallback(
    (canvas: HTMLCanvasElement, x0: number, w: number) => {
      if (waveform) drawTile(canvas, waveform, x0, w, height, { pxPerSecond, sourceOffset, loopLength, length, gain, fadeIn, fadeOut, color });
    },
    [waveform, height, pxPerSecond, sourceOffset, loopLength, length, gain, fadeIn, fadeOut, color]
  );
  if (!waveform || width <= 0) return null;
  const tiles = Math.ceil(width / TILE);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: tiles }, (_, i) => (
        <Tile key={i} x={i * TILE} w={Math.min(TILE, width - i * TILE)} h={height} draw={draw} version={version} />
      ))}
    </div>
  );
}
