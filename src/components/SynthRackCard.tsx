"use client";

import { useEffect, useMemo, useRef } from "react";
import { Maximize2 } from "lucide-react";
import { PluginKnob } from "./PluginKnob";
import { fraunces, spaceGrotesk } from "@/lib/pluginFonts";
import type { SynthParams } from "@/lib/synthParams";
import { warpedCycle } from "@/lib/synthViz";
import { WAVETABLE_INFO, factoryWavetable, previewFrames } from "@/lib/wavetableModel";

/** The synth in the FX rack: its preset, the waves it plays, and the four
 * macros (turn them here; set up what they move in the window). */
export function SynthRackCard({
  params,
  onChange,
  onDragStart,
  onOpen,
}: {
  params: SynthParams;
  onChange?: (p: SynthParams) => void;
  onDragStart?: () => void;
  onOpen?: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const waves = useMemo(
    () =>
      [params.osc1, params.osc2]
        .filter((o) => o.on)
        .map((o) => {
          const frames = previewFrames(factoryWavetable(o.table), 96);
          const f = Math.round(o.position * (frames.length - 1));
          return warpedCycle(frames[f], o.warp, o.warpAmount, 96);
        }),
    [params.osc1, params.osc2]
  );
  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    const dpr = window.devicePixelRatio || 1;
    const w = 232;
    const h = 34;
    c.width = w * dpr;
    c.height = h * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const colors = ["#F5A45D", "#9B7CF4"];
    waves.forEach((wave, i) => {
      g.beginPath();
      for (let k = 0; k < wave.length * 2; k++) {
        const x = (k / (wave.length * 2 - 1)) * w;
        const y = h / 2 - wave[k % wave.length] * (h / 2 - 3);
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = colors[i];
      g.globalAlpha = i === 0 ? 1 : 0.7;
      g.lineWidth = 1.6;
      g.stroke();
    });
    g.globalAlpha = 1;
  }, [waves]);

  const oscNames = [params.osc1, params.osc2]
    .filter((o) => o.on)
    .map((o) => o.userTable?.name ?? WAVETABLE_INFO[o.table].name)
    .join(" + ");

  return (
    <div className={`${spaceGrotesk.className} flex flex-1 flex-col gap-1`}>
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className={`${fraunces.className} text-[14px] font-semibold`} style={{ backgroundImage: "linear-gradient(90deg,#F5A45D,#F2706B,#9B7CF4)", WebkitBackgroundClip: "text", color: "transparent" }}>
            Daybreak
          </span>
          <span className="truncate text-[11px] text-[#F4EDE2]" title={oscNames || "Oscillators off"}>
            {params.preset ?? "Custom"}
          </span>
        </div>
        <button type="button" title="Open the synth" onClick={onOpen} className="flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-black/20">
          <Maximize2 size={11} />
        </button>
      </div>
      <button type="button" onClick={onOpen} title="Open the synth" className="block rounded-md" style={{ background: "#12131B", border: "1px solid #2A2B3C" }}>
        <canvas ref={canvas} style={{ width: 232, height: 34 }} className="block" />
      </button>
      <div className="flex items-center justify-between px-1">
        {([0, 1, 2, 3] as const).map((m) => (
          <PluginKnob
            key={m}
            label={`M${m + 1}`}
            value={params.macros[m]}
            min={0}
            max={1}
            defaultValue={0}
            mode="linear"
            size={26}
            onDragStart={onDragStart}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => {
              if (!onChange) return;
              const next = structuredClone(params);
              next.macros[m] = v;
              onChange(next);
            }}
          />
        ))}
      </div>
    </div>
  );
}
