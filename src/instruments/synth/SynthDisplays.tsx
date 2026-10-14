"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadUserWavetable, type SynthLiveState } from "./synth";
import { DEST_INDEX, fromNorm, DEST_SPECS, type ModDest, type SynthEnvParams, type SynthFilterParams, type SynthOscParams } from "./synthParams";
import { envLayout, envPath, envPosition, filterResponseDb, lfoShapeValue, warpedCycle } from "./synthViz";
import { factoryWavetable, previewFrames, type WavetableData } from "./wavetableModel";
import { SOURCE_COLORS, SYN, useSynth } from "./SynthUi";

/** Sizes a canvas for the screen's pixel density; returns its 2D context. */
function useCanvas(width: number, height: number) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    c.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [width, height]);
  return ref;
}

/** The latest value of something, for frame callbacks (kept in sync after each render). */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

const liveValue = (s: SynthLiveState | null, dest: ModDest): number | null => {
  if (!s?.mod || s.voices === 0) return null;
  return fromNorm(DEST_SPECS[DEST_INDEX[dest]], s.mod[DEST_INDEX[dest]]);
};

function mixColor(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(",")})`;
}

// --- wavetable ---

/** The oscillator's table as a stack of frames in perspective, with the
 * frame being played (warp included) lit up, following its modulation. */
export function WavetableView({ osc, index, width, height }: { osc: SynthOscParams; index: 0 | 1; width: number; height: number }) {
  const ui = useSynth();
  const canvas = useCanvas(width, height);
  const factory = useMemo(() => factoryWavetable(osc.table), [osc.table]);
  const [user, setUser] = useState<{ id: string; data: WavetableData | null } | null>(null);
  const userId = osc.userTable?.id;
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void loadUserWavetable(userId).then((data) => alive && setUser({ id: userId, data }));
    return () => {
      alive = false;
    };
  }, [userId]);
  const data = userId && user?.id === userId && user.data ? user.data : factory;
  const frames = useMemo(() => previewFrames(data, 128), [data]);
  const oscRef = useLatest(osc);
  const staticLayer = useRef<HTMLCanvasElement | null>(null);

  const geo = useMemo(() => {
    const F = frames.length;
    const padX = 8;
    const w = width - padX * 2;
    return {
      x: (f: number, i: number, n: number) => padX + (i / (n - 1)) * w * 0.7 + (F > 1 ? f / (F - 1) : 0) * w * 0.28,
      y: (f: number, v: number) => height * 0.74 - (F > 1 ? f / (F - 1) : 0) * height * 0.44 - v * height * 0.2,
    };
  }, [frames.length, width, height]);

  useEffect(() => {
    const layer = document.createElement("canvas");
    const dpr = window.devicePixelRatio || 1;
    layer.width = Math.round(width * dpr);
    layer.height = Math.round(height * dpr);
    const g = layer.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const F = frames.length;
    for (let f = F - 1; f >= 0; f--) {
      const d = F > 1 ? f / (F - 1) : 0;
      g.strokeStyle = mixColor("#F5A45D", "#9B7CF4", d);
      g.globalAlpha = 0.16 + 0.1 * (1 - d);
      g.lineWidth = 1;
      g.beginPath();
      const fr = frames[f];
      fr.forEach((v, i) => (i === 0 ? g.moveTo(geo.x(f, i, fr.length), geo.y(f, v)) : g.lineTo(geo.x(f, i, fr.length), geo.y(f, v))));
      g.stroke();
    }
    staticLayer.current = layer;
  }, [frames, geo, width, height]);

  useEffect(() => {
    const dest = `osc${index + 1}.position` as ModDest;
    const warpDest = `osc${index + 1}.warpAmount` as ModDest;
    return ui.onFrame((s) => {
      const c = canvas.current;
      const g = c?.getContext("2d");
      if (!c || !g || !staticLayer.current) return;
      const o = oscRef.current;
      g.clearRect(0, 0, width, height);
      g.globalAlpha = o.on ? 1 : 0.35;
      g.drawImage(staticLayer.current, 0, 0, width, height);
      const F = frames.length;
      const pos = liveValue(s, dest) ?? o.position;
      const amt = liveValue(s, warpDest) ?? o.warpAmount;
      const fi = Math.max(0, Math.min(F - 1, pos * (F - 1)));
      const f0 = Math.floor(fi);
      const f1 = Math.min(F - 1, f0 + 1);
      const t = fi - f0;
      const n = frames[0].length;
      const blended = new Float32Array(n);
      for (let i = 0; i < n; i++) blended[i] = frames[f0][i] + (frames[f1][i] - frames[f0][i]) * t;
      const cycle = warpedCycle(blended, o.warp, amt, n);
      const grad = g.createLinearGradient(0, 0, width, 0);
      grad.addColorStop(0, "#F5A45D");
      grad.addColorStop(0.5, "#F2706B");
      grad.addColorStop(1, "#9B7CF4");
      g.beginPath();
      cycle.forEach((v, i) => (i === 0 ? g.moveTo(geo.x(fi, i, n), geo.y(fi, v)) : g.lineTo(geo.x(fi, i, n), geo.y(fi, v))));
      g.lineTo(geo.x(fi, n - 1, n), geo.y(fi, 0));
      g.lineTo(geo.x(fi, 0, n), geo.y(fi, 0));
      g.closePath();
      g.globalAlpha = o.on ? 0.14 : 0.05;
      g.fillStyle = grad;
      g.fill();
      g.globalAlpha = o.on ? 1 : 0.4;
      g.beginPath();
      cycle.forEach((v, i) => (i === 0 ? g.moveTo(geo.x(fi, i, n), geo.y(fi, v)) : g.lineTo(geo.x(fi, i, n), geo.y(fi, v))));
      g.strokeStyle = grad;
      g.lineWidth = 2;
      g.shadowColor = "rgba(242,112,107,0.6)";
      g.shadowBlur = 8;
      g.stroke();
      g.shadowBlur = 0;
      g.globalAlpha = 1;
      g.fillStyle = SYN.muted;
      g.font = "9px ui-monospace, monospace";
      g.fillText(`${Math.round(fi) + 1}/${F}`, width - 34, 12);
    });
  }, [ui, canvas, frames, geo, width, height, index, oscRef]);

  return <canvas ref={canvas} style={{ width, height }} className="block rounded-lg" aria-label="Wavetable" />;
}

// --- filter ---

const FREQS = Array.from({ length: 140 }, (_, i) => 20 * Math.pow(1000, i / 139));
const DB_TOP = 18;
const DB_BOTTOM = -36;

export function FilterView({ filter, index, width, height }: { filter: SynthFilterParams; index: 0 | 1; width: number; height: number }) {
  const ui = useSynth();
  const canvas = useCanvas(width, height);
  const fRef = useLatest(filter);
  useEffect(() => {
    const n = index + 1;
    const keys = ["cutoff", "resonance", "morph", "mix"].map((k) => `filter${n}.${k}` as ModDest);
    const x = (f: number) => (Math.log(f / 20) / Math.log(1000)) * width;
    const y = (db: number) => ((DB_TOP - Math.max(DB_BOTTOM, Math.min(DB_TOP, db))) / (DB_TOP - DB_BOTTOM)) * height;
    const curve = (g: CanvasRenderingContext2D, f: SynthFilterParams, cutoff: number, res: number, morph: number, mix: number) => {
      g.beginPath();
      FREQS.forEach((hz, i) => {
        const db = f.on ? filterResponseDb(f.type, cutoff, res, morph, mix, hz) : 0;
        if (i === 0) g.moveTo(x(hz), y(db));
        else g.lineTo(x(hz), y(db));
      });
    };
    return ui.onFrame((s) => {
      const g = canvas.current?.getContext("2d");
      if (!g) return;
      const f = fRef.current;
      g.clearRect(0, 0, width, height);
      g.strokeStyle = "rgba(255,255,255,0.05)";
      g.lineWidth = 1;
      [100, 1000, 10000].forEach((hz) => {
        g.beginPath();
        g.moveTo(x(hz), 0);
        g.lineTo(x(hz), height);
        g.stroke();
      });
      g.beginPath();
      g.moveTo(0, y(0));
      g.lineTo(width, y(0));
      g.stroke();
      const lv = keys.map((k) => liveValue(s, k));
      const live = lv[0] !== null;
      // The knob settings, dim when modulation moves it elsewhere.
      curve(g, f, f.cutoff, f.resonance, f.morph, f.mix);
      g.strokeStyle = live ? "rgba(245,164,93,0.35)" : SYN.accent;
      g.lineWidth = live ? 1.2 : 2;
      g.stroke();
      const cutoff = lv[0] ?? f.cutoff;
      const res = lv[1] ?? f.resonance;
      const morph = lv[2] ?? f.morph;
      const mix = lv[3] ?? f.mix;
      curve(g, f, cutoff, res, morph, mix);
      g.lineTo(width, height);
      g.lineTo(0, height);
      g.closePath();
      g.fillStyle = f.on ? "rgba(242,112,107,0.10)" : "rgba(255,255,255,0.03)";
      g.fill();
      if (live) {
        curve(g, f, cutoff, res, morph, mix);
        g.strokeStyle = "#F2706B";
        g.lineWidth = 2;
        g.stroke();
      }
    });
  }, [ui, canvas, fRef, index, width, height]);
  return <canvas ref={canvas} style={{ width, height }} className="block rounded-lg" aria-label="Filter response" />;
}

// --- envelope ---

type EnvHandle = "delay" | "attack" | "hold" | "decay" | "release" | "ac" | "dc" | "rc";

/** The envelope, drawn and edited in place: drag the points for times (and
 * the sustain level), the small ones on each slope to bend it. */
export function EnvelopeEditor({ index, width, height }: { index: 0 | 1 | 2; width: number; height: number }) {
  const ui = useSynth();
  const env = ui.params.envs[index];
  const pad = 8;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const drag = useRef<{ handle: EnvHandle; x: number; y: number; start: SynthEnvParams; span: number } | null>(null);
  const [span, setSpan] = useState<number | null>(null);
  const layout = envLayout(env, w, span ?? undefined);
  const px = (x: number) => pad + x;
  const py = (level: number) => pad + (1 - level) * h;
  const path = envPath(env, layout)
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${px(x).toFixed(1)} ${py(y).toFixed(1)}`)
    .join(" ");
  const color = SOURCE_COLORS[`env${index + 1}` as "env1"];
  const dot = useRef<SVGCircleElement>(null);
  const envRef = useLatest(env);

  useEffect(
    () =>
      ui.onFrame((s) => {
        const el = dot.current;
        if (!el) return;
        const e = s?.env?.[index];
        const cur = envRef.current;
        const pos = e && s!.voices > 0 ? envPosition(cur, envLayout(cur, w), e[0], e[1]) : null;
        if (!pos) {
          el.setAttribute("opacity", "0");
          return;
        }
        el.setAttribute("cx", String(pad + pos[0]));
        el.setAttribute("cy", String(pad + (1 - pos[1]) * h));
        el.setAttribute("opacity", "1");
      }),
    [ui, index, envRef, w, h]
  );

  const start = (handle: EnvHandle) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    const total = Math.max(0.5, env.delay + env.attack + env.hold + env.decay + env.release);
    drag.current = { handle, x: e.clientX, y: e.clientY, start: { ...env }, span: total };
    setSpan(total);
    ui.begin();
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const spx = envLayout(d.start, w, d.span).secondsPerX * (e.shiftKey ? 0.2 : 1);
    const dx = (e.clientX - d.x) * spx;
    const dy = (e.clientY - d.y) / h;
    const s = d.start;
    const time = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    ui.update((p) => {
      const t = p.envs[index];
      switch (d.handle) {
        case "delay": t.delay = time(s.delay + dx, 0, 4); break;
        case "attack": t.attack = time(s.attack + dx, 0, 20); break;
        case "hold": t.hold = time(s.hold + dx, 0, 4); break;
        case "decay":
          t.decay = time(s.decay + dx, 0.001, 30);
          t.sustain = Math.min(1, Math.max(0, s.sustain - dy));
          break;
        case "release": t.release = time(s.release + dx, 0.001, 30); break;
        case "ac": t.attackCurve = Math.min(1, Math.max(-1, s.attackCurve - dy * 2.5)); break;
        case "dc": t.decayCurve = Math.min(1, Math.max(-1, s.decayCurve + dy * 2.5)); break;
        case "rc": t.releaseCurve = Math.min(1, Math.max(-1, s.releaseCurve + dy * 2.5)); break;
      }
    });
  };
  const end = () => {
    drag.current = null;
    setSpan(null);
  };

  const [xd, xa, xh, xdc, xs, xr] = layout.x;
  const mid = (x0: number, x1: number, y: (t: number) => number) => ({ x: px((x0 + x1) / 2), y: py(y(0.5)) });
  const bend = (k: number) => (x: number) => (k > 0.001 ? 1 - Math.pow(1 - x, 1 + 4 * k) : k < -0.001 ? Math.pow(x, 1 - 4 * k) : x);
  const handles: { id: EnvHandle; x: number; y: number; cursor: string; small?: boolean; tip: string }[] = [
    { id: "delay", x: px(xd), y: py(0), cursor: "ew-resize", tip: "Delay" },
    { id: "attack", x: px(xa), y: py(1), cursor: "ew-resize", tip: "Attack" },
    { id: "hold", x: px(xh), y: py(1), cursor: "ew-resize", tip: "Hold" },
    { id: "decay", x: px(xdc), y: py(env.sustain), cursor: "move", tip: "Decay (left/right) and sustain (up/down)" },
    { id: "release", x: px(xr), y: py(0), cursor: "ew-resize", tip: "Release" },
    { ...mid(xd, xa, bend(env.attackCurve)), id: "ac", cursor: "ns-resize", small: true, tip: "Attack curve" },
    { ...mid(xh, xdc, (t) => env.sustain + (1 - env.sustain) * (1 - bend(env.decayCurve)(t))), id: "dc", cursor: "ns-resize", small: true, tip: "Decay curve" },
    { ...mid(xs, xr, (t) => env.sustain * (1 - bend(env.releaseCurve)(t))), id: "rc", cursor: "ns-resize", small: true, tip: "Release curve" },
  ];

  return (
    <svg width={width} height={height} className="block rounded-lg" style={{ background: SYN.bg }} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <line x1={px(xdc)} x2={px(xs)} y1={py(env.sustain)} y2={py(env.sustain)} stroke={color} strokeOpacity={0.25} strokeDasharray="3 3" />
      <path d={`${path} L${px(xr)} ${py(0)} L${px(0)} ${py(0)} Z`} fill={color} fillOpacity={0.1} />
      <path d={path} stroke={color} strokeWidth={2} fill="none" />
      {handles.map((hd) => (
        <circle
          key={hd.id}
          cx={hd.x}
          cy={hd.y}
          r={hd.small ? 3.2 : 4.6}
          fill={hd.small ? SYN.bg : SYN.panelHi}
          stroke={color}
          strokeWidth={1.6}
          style={{ cursor: hd.cursor }}
          onPointerDown={start(hd.id)}
          onDoubleClick={() => {
            if (!hd.small) return;
            ui.begin();
            ui.update((p) => {
              const t = p.envs[index];
              if (hd.id === "ac") t.attackCurve = 0;
              if (hd.id === "dc") t.decayCurve = 0;
              if (hd.id === "rc") t.releaseCurve = 0;
            });
          }}
        >
          <title>{hd.tip}</title>
        </circle>
      ))}
      <circle ref={dot} r={4} fill="#fff" opacity={0} style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
    </svg>
  );
}

// --- LFO ---

export function LfoView({ index, width, height }: { index: 0 | 1 | 2; width: number; height: number }) {
  const ui = useSynth();
  const canvas = useCanvas(width, height);
  const lfo = ui.params.lfos[index];
  const lfoRef = useLatest(lfo);
  const color = SOURCE_COLORS[`lfo${index + 1}` as "lfo1"];
  useEffect(
    () =>
      ui.onFrame((s) => {
        const g = canvas.current?.getContext("2d");
        if (!g) return;
        const l = lfoRef.current;
        const pad = 6;
        const w = width - pad * 2;
        const h = height - pad * 2;
        g.clearRect(0, 0, width, height);
        g.strokeStyle = "rgba(255,255,255,0.06)";
        g.beginPath();
        g.moveTo(pad, pad + h / 2);
        g.lineTo(pad + w, pad + h / 2);
        g.stroke();
        g.beginPath();
        for (let i = 0; i <= 160; i++) {
          const p = i / 160;
          const q = (p + l.phase) % 1;
          const v = lfoShapeValue(l.shape, q);
          const x = pad + p * w;
          const y = pad + (1 - v) * h;
          if (i === 0) g.moveTo(x, y);
          else if (l.shape === "square" || l.shape === "stepped") {
            // Hold, then jump.
            const prev = lfoShapeValue(l.shape, (((i - 1) / 160) + l.phase) % 1);
            g.lineTo(x, pad + (1 - prev) * h);
            g.lineTo(x, y);
          } else g.lineTo(x, y);
        }
        g.strokeStyle = color;
        g.lineWidth = 2;
        g.stroke();
        g.lineTo(pad + w, pad + h);
        g.lineTo(pad, pad + h);
        g.closePath();
        g.globalAlpha = 0.1;
        g.fillStyle = color;
        g.fill();
        g.globalAlpha = 1;
        const st = s?.lfo?.[index];
        if (st && (s!.voices > 0 || l.mode === "free")) {
          const phase = st[0] % 1;
          const v = s!.voices > 0 ? st[1] : lfoShapeValue(l.shape, (phase + l.phase) % 1);
          g.beginPath();
          g.arc(pad + phase * w, pad + (1 - v) * h, 4, 0, Math.PI * 2);
          g.fillStyle = "#fff";
          g.shadowColor = color;
          g.shadowBlur = 8;
          g.fill();
          g.shadowBlur = 0;
        }
      }),
    [ui, canvas, lfoRef, index, width, height, color]
  );
  return <canvas ref={canvas} style={{ width, height, background: SYN.bg }} className="block rounded-lg" aria-label={`LFO ${index + 1} shape`} />;
}

// --- scope ---

export function Scope({ width, height }: { width: number; height: number }) {
  const ui = useSynth();
  const canvas = useCanvas(width, height);
  useEffect(
    () =>
      ui.onFrame((s) => {
        const g = canvas.current?.getContext("2d");
        if (!g) return;
        g.clearRect(0, 0, width, height);
        const data = s?.scope;
        g.strokeStyle = "rgba(255,255,255,0.08)";
        g.beginPath();
        g.moveTo(0, height / 2);
        g.lineTo(width, height / 2);
        g.stroke();
        if (!data || s!.voices === 0) return;
        // Start on a rising zero crossing so the picture holds still.
        let start = 0;
        for (let i = 1; i < 480; i++) {
          if (data[i - 1] <= 0 && data[i] > 0) {
            start = i;
            break;
          }
        }
        const grad = g.createLinearGradient(0, 0, width, 0);
        grad.addColorStop(0, "#F5A45D");
        grad.addColorStop(0.5, "#F2706B");
        grad.addColorStop(1, "#9B7CF4");
        g.beginPath();
        const n = 512;
        for (let i = 0; i < n; i++) {
          const v = data[start + i] ?? 0;
          const x = (i / (n - 1)) * width;
          const y = height / 2 - Math.max(-1, Math.min(1, v)) * (height / 2 - 2);
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.strokeStyle = grad;
        g.lineWidth = 1.5;
        g.stroke();
      }),
    [ui, canvas, width, height]
  );
  return <canvas ref={canvas} style={{ width, height, background: SYN.bg }} className="block rounded-md" aria-label="Oscilloscope" />;
}
