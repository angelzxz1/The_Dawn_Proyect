"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ExternalLink, Feather, Loader2 } from "lucide-react";
import type { EffectFileRef } from "@/lib/effects";
import { bundledTones, FACTORY_CAB_TONES, fetchToneFile, type ToneEntry } from "@/lib/tones";
import { packTones } from "@/lib/packStore";

/** "Browse tones" for the IR Loader and NAM Amp: Dawn's own cabinets and
 * any bundled captures/IRs, each with a description and its creator's
 * credit. Picking one loads it - no hunting for files. */
export function TonePicker({
  kind,
  currentId,
  onPick,
  onLoadFile,
}: {
  kind: "ir" | "amp";
  currentId: string | undefined;
  /** Loads a file that's always available (one of Dawn's cabinets). */
  onPick: (ref: EffectFileRef) => void;
  /** Loads a bundled file once downloaded; resolves with an error message, or null. */
  onLoadFile: (file: File) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [bundled, setBundled] = useState<ToneEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || bundled) return;
    let alive = true;
    void bundledTones().then((t) => alive && setBundled(t.filter((x) => x.kind === kind)));
    return () => {
      alive = false;
    };
  }, [open, bundled, kind]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", down);
    return () => window.removeEventListener("pointerdown", down);
  }, [open]);

  const tones = [...(kind === "ir" ? FACTORY_CAB_TONES : []), ...(bundled ?? []), ...(open ? packTones(kind) : [])];

  const pick = async (t: ToneEntry) => {
    setError(null);
    if (!t.file) {
      onPick({ id: t.id, name: t.name });
      setOpen(false);
      return;
    }
    setBusy(t.id);
    try {
      const err = await onLoadFile(await fetchToneFile(t));
      if (err) setError(err);
      else setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[12px] text-[#C9C9D1] hover:bg-white/[0.06]"
      >
        {kind === "ir" ? "Browse cabinets" : "Browse amp tones"}
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-1 flex max-h-[320px] w-[340px] flex-col overflow-y-auto rounded-xl border border-white/10 bg-[#17171C] p-1.5 shadow-2xl">
          {tones.length === 0 && bundled !== null && (
            <div className="flex flex-col gap-2 p-3 text-[12px] leading-relaxed text-[#9A9AA4]">
              <p>No amp captures are bundled with Dawn yet.</p>
              <p>
                Load any <code>.nam</code> file from your computer with the slot above. Thousands of free captures are shared
                on{" "}
                <a href="https://www.tone3000.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[#E6AD5E] hover:underline">
                  TONE3000 <ExternalLink size={10} />
                </a>
                .
              </p>
            </div>
          )}
          {tones.length === 0 && bundled === null && (
            <p className="flex items-center gap-1.5 p-3 text-[12px] text-[#9A9AA4]">
              <Loader2 size={12} className="animate-spin" /> Loading…
            </p>
          )}
          {tones.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => void pick(t)}
              disabled={!!busy}
              className={`flex flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left hover:bg-white/[0.06] disabled:opacity-60 ${
                currentId === t.id ? "bg-[#E6AD5E]/10" : ""
              }`}
            >
              <span className="flex items-center gap-1.5 text-[12.5px] text-[#F4EDE2]">
                {busy === t.id && <Loader2 size={11} className="animate-spin" />}
                {t.name}
                {t.use === "bass" && <span className="rounded bg-white/10 px-1 text-[9.5px] text-[#9A9AA4]">bass</span>}
                {t.light && (
                  <span className="flex items-center gap-0.5 rounded bg-white/10 px-1 text-[9.5px] text-[#9A9AA4]" title="Uses less CPU">
                    <Feather size={9} /> light
                  </span>
                )}
              </span>
              {t.description && <span className="text-[11px] leading-snug text-[#9A9AA4]">{t.description}</span>}
              <span className="text-[10.5px] text-[#77777F]">
                by{" "}
                {t.creatorUrl ? (
                  <a href={t.creatorUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[#E6AD5E] hover:underline">
                    {t.creator}
                  </a>
                ) : (
                  t.creator
                )}
                {t.license ? ` · ${t.license}` : ""}
              </span>
            </button>
          ))}
          {error && <p className="px-2.5 py-1.5 text-[11.5px] text-[#FF6B6B]">{error}</p>}
        </div>
      )}
    </div>
  );
}
