// Small drawings of Dawn's parts for the website: signal chains, an EQ
// curve, a recorded take, amp knobs, routing, a piano roll, a project
// folder, export formats and a latency budget. Drawn in code so they stay
// sharp and follow the site's colors.

import type { ReactNode } from "react";

const mono = "font-code";

/** A row of devices joined by arrows; `hot` ones are filled. */
export function ChainChips({ items, hot = [] }: { items: string[]; hot?: string[] }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {items.map((item, i) => (
        <span key={item} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-[#4a4b54]">→</span>}
          <span
            className={`rounded-[7px] border px-[9px] py-1.5 text-[12px] font-semibold ${hot.includes(item) ? "border-accent bg-accent text-background" : "border-border-strong bg-surface-raised text-foreground"}`}
          >
            {item}
          </span>
        </span>
      ))}
    </div>
  );
}

/** The well a drawing sits in on a card. */
export function Well({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`overflow-hidden rounded-[14px] border border-border bg-background p-5 ${className}`}>{children}</div>;
}

/** A parametric EQ curve with three band handles. */
export function EqCurve() {
  const bands = [
    { x: 70, gain: 16, width: 34 },
    { x: 120, gain: -24, width: 16 },
    { x: 210, gain: 20, width: 40 },
  ];
  const y = (x: number) => 60 - bands.reduce((sum, b) => sum + b.gain * Math.exp(-(((x - b.x) / b.width) ** 2)), 0) + (x > 258 ? ((x - 258) / 22) ** 2 * 40 : 0);
  const pts = Array.from({ length: 101 }, (_, i) => {
    const x = (i / 100) * 280;
    return `${x.toFixed(1)} ${y(x).toFixed(1)}`;
  });
  const line = `M${pts.join(" L")}`;
  return (
    <svg width="100%" height="120" viewBox="0 0 280 120" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="60" x2="280" y2="60" className="stroke-border" />
      {[70, 140, 210].map((x) => (
        <line key={x} x1={x} y1="0" x2={x} y2="120" stroke="#1f2027" />
      ))}
      <path d={`${line} L280 120 L0 120 Z`} className="fill-accent" opacity="0.14" />
      <path d={line} className="stroke-accent" strokeWidth="2" fill="none" />
      {bands.map((b) => (
        <circle key={b.x} cx={b.x} cy={y(b.x)} r="5" className="fill-foreground stroke-background" strokeWidth="2" />
      ))}
    </svg>
  );
}

/** A project folder, as a file tree. */
export function FileTree({ lines }: { lines: { text: string; depth: number; hot?: boolean }[] }) {
  return (
    <div className={`${mono} flex flex-col gap-1.5 text-[12.5px] text-soft`}>
      {lines.map((l, i) => (
        <div key={i} style={{ paddingLeft: l.depth * 16 }} className={l.hot ? "text-accent" : l.text.endsWith("/") ? "text-foreground" : ""}>
          {l.text}
        </div>
      ))}
    </div>
  );
}

/** Bars of a recorded waveform, the same every time. */
function waveBars(x: number, y: number, w: number, h: number, seed = 1) {
  const bars: ReactNode[] = [];
  const step = 5.2;
  for (let i = 0; x + 4 + i * step < x + w - 4; i++) {
    const v = 0.15 + 0.85 * Math.abs(Math.sin(i * 0.9 + seed) * Math.cos(i * 0.23 + seed * 2));
    const bh = Math.max(3, v * (h - 6));
    bars.push(<rect key={i} x={x + 4 + i * step} y={y + (h - bh) / 2} width="2.6" height={bh} rx="1" className="fill-background" fillOpacity="0.5" />);
  }
  return bars;
}

/** A take as heard (late) and as Dawn lines it up with the grid. */
export function AlignedTake() {
  const beats = ["1.1", "1.2", "1.3", "1.4", "2.1", "2.2", "2.3", "2.4"];
  return (
    <svg width="100%" viewBox="0 0 540 184" role="img" aria-label="A recorded take before and after latency alignment" className="block">
      {beats.map((b, i) => (
        <g key={b}>
          <line x1={20 + i * 70} y1="34" x2={20 + i * 70} y2="170" stroke={i % 4 === 0 ? "#3a3b44" : "#23242b"} />
          <text x={24 + i * 70} y="26" className="fill-muted font-code" fontSize="10">
            {b}
          </text>
        </g>
      ))}
      <text x="20" y="54" className="fill-muted" fontSize="10" fontWeight="600" letterSpacing="1.2">
        AS HEARD (LATE)
      </text>
      <rect x="48" y="62" width="262" height="34" rx="6" fill="none" stroke="#6e6e78" strokeDasharray="4 3" />
      <path d="M48 104 L24 126" className="stroke-accent" strokeWidth="1.5" />
      <path d="M24 119 L24 126 L31 126" className="stroke-accent" strokeWidth="1.5" fill="none" />
      <text x="40" y="124" className="fill-accent" fontSize="10" fontWeight="600" letterSpacing="1.2">
        ALIGNED TAKE
      </text>
      <rect x="20" y="132" width="262" height="34" rx="6" fill="#d8913f" />
      {waveBars(20, 132, 262, 34)}
    </svg>
  );
}

/** A plugin knob, `value` 0..1. */
export function Knob({ label, value }: { label: string; value: number }) {
  const r = 14;
  const start = -225;
  const angle = start + value * 270;
  const rad = (a: number) => (a * Math.PI) / 180;
  const p = (a: number, rr = r) => `${(18 + rr * Math.cos(rad(a))).toFixed(2)} ${(18 + rr * Math.sin(rad(a))).toFixed(2)}`;
  const arc = (from: number, to: number) => `M${p(from)} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${p(to)}`;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
        <path d={arc(start, start + 270)} fill="none" stroke="#2e2f37" strokeWidth="3" strokeLinecap="round" />
        <path d={arc(start, angle)} fill="none" className="stroke-accent" strokeWidth="3" strokeLinecap="round" />
        <circle cx="18" cy="18" r="9.5" fill="#23242b" />
        <path d={`M${p(angle, 4)} L${p(angle, 9)}`} className="stroke-foreground" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="text-[9px] font-semibold tracking-[1.2px] text-muted">{label}</span>
    </div>
  );
}

/** A device card from the effects rack. */
export function DeviceCard({ name, tag, knobs }: { name: string; tag: string; knobs: [string, number][] }) {
  return (
    <div className="flex min-w-0 flex-1 basis-[200px] flex-col gap-3.5 rounded-xl border border-border bg-surface p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-[15px] font-semibold text-foreground">{name}</span>
        <span className={`${mono} truncate rounded-md border border-border px-1.5 py-0.5 text-[10px] text-soft`}>{tag}</span>
      </div>
      <div className="flex justify-between gap-2">
        {knobs.map(([label, v]) => (
          <Knob key={label} label={label} value={v} />
        ))}
      </div>
    </div>
  );
}

const box = "fill-surface stroke-border-strong";

/** Tracks feeding a reverb bus and the master, with the kick sidechaining the bass. */
export function Routing() {
  const tracks: [string, string, number][] = [
    ["Kick", "drums", 14],
    ["Bass", "comp · sidechain", 82],
    ["Guitar", "amp chain", 150],
    ["Vocals", "vocal chain", 218],
  ];
  const node = (x: number, y: number, title: string, sub: string, hot = false) => (
    <g key={title}>
      <rect x={x} y={y} width="130" height="44" rx="8" className={hot ? "stroke-accent" : box} fill={hot ? "#2a2419" : undefined} />
      <text x={x + 12} y={y + 19} className="fill-foreground" fontSize="12" fontWeight="600">
        {title}
      </text>
      <text x={x + 12} y={y + 34} className="fill-muted font-code" fontSize="9">
        {sub}
      </text>
    </g>
  );
  return (
    <svg width="100%" viewBox="0 0 520 300" role="img" aria-label="Routing: tracks feed a reverb bus and the master; the kick sidechains the bass compressor" className="block">
      {tracks.map(([, , y]) => (
        <path key={y} d={`M140 ${y + 22} C 260 ${y + 22}, 300 142, 380 142`} stroke="#4a4b54" strokeWidth="1.5" fill="none" />
      ))}
      <path d="M140 172 C 180 172, 190 142, 220 142" className="stroke-accent" strokeOpacity="0.6" strokeWidth="1.5" strokeDasharray="4 3" fill="none" />
      <path d="M140 240 C 180 240, 190 150, 220 150" className="stroke-accent" strokeOpacity="0.6" strokeWidth="1.5" strokeDasharray="4 3" fill="none" />
      <path d="M350 142 L380 142" stroke="#4a4b54" strokeWidth="1.5" />
      {tracks.map(([t, sub, y]) => node(10, y, t, sub, t === "Bass"))}
      {node(220, 120, "Reverb bus", "send / return")}
      {node(380, 120, "Master", "limiter · −1.0 dB")}
      <path d="M30 58 L30 82" className="stroke-accent" strokeWidth="2" />
      <path d="M25 76 L30 82 L35 76" className="stroke-accent" strokeWidth="2" fill="none" />
      <text x="40" y="74" className="fill-accent font-code" fontSize="9">
        sidechain
      </text>
      <text x="220" y="290" className="fill-muted font-code" fontSize="9">
        — audio ┅ send
      </text>
    </svg>
  );
}

/** A few bars of notes in a piano roll. */
export function PianoRoll() {
  const notes: [number, number, number][] = [
    [0, 5, 4], [4, 6, 4], [10, 2, 1], [14, 4, 4], [18, 3, 2], [20, 0, 3], [24, 1, 2], [28, 3, 4],
    [32, 2, 1], [36, 6, 2], [38, 1, 1], [42, 4, 3], [46, 4, 2], [50, 5, 2], [54, 0, 2], [58, 7, 2], [62, 4, 1],
  ];
  const rows = 9;
  return (
    <svg width="100%" viewBox="0 0 500 170" role="img" aria-label="Notes in the piano roll, with the scale's rows highlighted" className="block">
      <rect x="0" y="0" width="500" height="170" rx="8" fill="#1b1c22" />
      {Array.from({ length: rows }, (_, r) => (
        <g key={r}>
          <rect x="34" y={22 + r * 16} width="466" height="16" fill={r % 3 === 1 ? "#1f2027" : "#23242b"} opacity="0.6" />
          <rect x="0" y={23 + r * 16} width="30" height="14" fill={r % 3 === 1 ? "#3a3b44" : "#d9d9de"} />
        </g>
      ))}
      {[0, 1, 2, 3, 4].map((b) => (
        <g key={b}>
          <line x1={34 + b * 116} y1="22" x2={34 + b * 116} y2="166" stroke="#2e2f37" />
          <text x={38 + b * 116} y="15" className="fill-muted font-code" fontSize="10">
            {b + 1}
          </text>
        </g>
      ))}
      {notes.map(([start, row, len], i) => (
        <rect key={i} x={36 + start * 7.25} y={25 + (rows - 1 - row) * 16} width={Math.max(2, len) * 7.25 - 2} height="10" rx="2" className="fill-accent" />
      ))}
    </svg>
  );
}

/** The export choices. */
export function ExportList() {
  const rows: [string, string][] = [
    ["MP3", "128–320 kbps"],
    ["WAV", "16 / 24-bit"],
    ["Stems", "one WAV per track"],
    ["MIDI", ".mid per clip or track"],
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] font-semibold tracking-[1.6px] text-muted">EXPORT AS</div>
      {rows.map(([name, detail]) => (
        <div key={name} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
          <span className="text-[14px] font-semibold text-foreground">{name}</span>
          <span className={`${mono} text-[11px] text-soft`}>{detail}</span>
        </div>
      ))}
    </div>
  );
}

/** Where an example 11 ms of delay comes from. */
export function LatencyBar() {
  const parts: [string, number, string][] = [
    ["Interface", 3, "bg-[#3a3b44]"],
    ["Browser buffer", 5, "bg-[#6e6e78]"],
    ["Amp + effects", 2, "bg-accent text-background"],
    ["Output", 1, "bg-[#3a3b44]"],
  ];
  return (
    <div role="img" aria-label="Example latency: interface 3 ms, browser buffer 5 ms, amp and effects 2 ms, output 1 ms, total 11 ms" className="flex flex-col gap-2">
      <div className="flex h-10 overflow-hidden rounded-[10px]">
        {parts.map(([label, ms, color]) => (
          <div key={label} style={{ flexGrow: ms }} className={`${color} ${mono} flex basis-0 items-center border-r-2 border-surface px-2.5 text-[12px] last:border-r-0`}>
            {ms} ms
          </div>
        ))}
      </div>
      <div className="flex">
        {parts.map(([label, ms]) => (
          <div key={label} style={{ flexGrow: ms }} className="basis-0 truncate pr-2 text-[12px] text-muted">
            {label}
          </div>
        ))}
      </div>
      <div className={`${mono} text-[12px] text-foreground`}>Example total: 11 ms</div>
    </div>
  );
}

/** A monthly pack's cover: the dawn, a little lower each month. */
export function PackCover({ n }: { n: number }) {
  return (
    <div className="relative h-[74px] overflow-hidden border-b border-border bg-background">
      <svg width="100%" height="74" viewBox="0 0 300 74" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <path d="M90 74 A60 60 0 0 1 210 74 Z" className="fill-accent" opacity={0.95 - (n - 1) * 0.1} />
        <rect x="0" y="34" width="300" height="3" className="fill-background" />
        <rect x="0" y="50" width="300" height="4" className="fill-background" />
        <rect x="0" y="64" width="300" height="5" className="fill-background" />
      </svg>
      <span className={`${mono} absolute left-3 top-2.5 text-[10px] tracking-[1px] text-soft`}>PACK {String(n).padStart(2, "0")}</span>
    </div>
  );
}

/** Small mono labels in a row, like the studio's status chips. */
export function StatusChips({ chips }: { chips: { text: string; tone?: "rec" | "accent" | "dim" }[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <span
          key={c.text}
          className={`${mono} rounded-[7px] border bg-surface px-2.5 py-1.5 text-[11px] ${
            c.tone === "rec" ? "border-[#7a3a38] text-foreground" : c.tone === "accent" ? "border-accent text-accent" : c.tone === "dim" ? "border-border text-soft" : "border-border text-foreground"
          }`}
        >
          {c.text}
        </span>
      ))}
    </div>
  );
}

/** An input level meter peaking around −12 dBFS. */
export function InputLevel() {
  const segs = 30;
  return (
    <svg width="100%" viewBox="0 0 520 60" role="img" aria-label="Input level peaking around −12 dBFS, below the clip light" className="block">
      {Array.from({ length: segs }, (_, i) => {
        const lit = i < 21;
        const fill = i >= 27 ? "#7a3a38" : i >= 22 ? "#6e5a35" : undefined;
        return <rect key={i} x={i * 17} y="14" width="14" height="22" rx="2" className={lit ? "fill-accent" : ""} fill={lit ? undefined : (fill ?? "#23242b")} />;
      })}
      <text x="357" y="54" className="fill-muted font-code" fontSize="10">
        −12 dB
      </text>
      <text x="459" y="54" className="fill-muted font-code" fontSize="10">
        clip
      </text>
    </svg>
  );
}

/** A clip with a waveform, for the record step. */
export function RecordedClip() {
  return (
    <svg width="100%" viewBox="0 0 520 90" role="img" aria-label="A take recorded across a looped section" className="block">
      <rect x="0" y="0" width="520" height="12" rx="3" fill="#23242b" />
      <rect x="40" y="0" width="300" height="12" rx="3" className="fill-accent" opacity="0.5" />
      <line x1="200" y1="0" x2="200" y2="90" className="stroke-foreground" strokeWidth="1.5" />
      <rect x="40" y="26" width="160" height="50" rx="6" fill="#d8913f" />
      {waveBars(40, 26, 160, 50, 3)}
      <rect x="200" y="26" width="140" height="50" rx="6" fill="none" stroke="#6e6e78" strokeDasharray="4 3" />
    </svg>
  );
}
