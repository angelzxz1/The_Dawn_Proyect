"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Cpu, Timer } from "lucide-react";
import { audioEngine } from "@/lib/audioEngine";
import { cpuReading, type CpuReading } from "@/lib/cpuMeter";
import { loadAudioPrefs, saveAudioPrefs, type AudioPrefs } from "@/lib/audioPrefs";
import { useShortcuts } from "@/lib/shortcuts";

const ms = (seconds: number) => `${(seconds * 1000).toFixed(1)} ms`;

function loadColor(load: number): string {
  return load >= 0.85 ? "#FF6B6B" : load >= 0.6 ? "#E6AD5E" : "#6BD68B";
}

function Toggle({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span className="flex flex-col">
        <span className="text-[12px] text-foreground">{label}</span>
        <span className="text-[11px] leading-snug text-muted">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors"
        style={{ background: value ? "#E6AD5E" : "#2E2F37" }}
      >
        <span className="absolute top-0.5 h-4 w-4 rounded-full bg-[#F4EDE2] transition-all" style={{ left: value ? 18 : 2 }} />
      </button>
    </label>
  );
}

function Row({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12px]" title={title}>
      <span className="text-muted">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

/** The CPU meter in the transport bar, and the Audio panel it opens:
 * latency figures, delay compensation, and recording latency correction.
 * These settings belong to this computer, so they're kept in the browser
 * (audioPrefs.ts), not in the project. */
export function AudioStatus() {
  const [prefs, setPrefs] = useState<AudioPrefs>(() => loadAudioPrefs());
  const [cpu, setCpu] = useState<CpuReading | null>(null);
  const [open, setOpen] = useState(false);
  const [, setLatencyTick] = useState(0);
  const [measure, setMeasure] = useState<{ state: "idle" | "running" | "failed" | "done"; message?: string }>({ state: "idle" });
  const [offsetDraft, setOffsetDraft] = useState(String(prefs.recordingOffsetMs));
  const rootRef = useRef<HTMLDivElement>(null);
  const [deviceRates, setDeviceRates] = useState<{ output: number | null; input: number | null } | null>(null);

  // The engine follows the settings.
  useEffect(() => {
    audioEngine.setDelayCompensation(prefs.delayCompensation);
    audioEngine.setReducedLatencyMonitoring(prefs.reducedLatencyMonitoring);
    audioEngine.setRecordingCorrection(prefs.measuredRoundTrip, prefs.recordingOffsetMs);
  }, [prefs]);

  const update = useCallback((change: Partial<AudioPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...change };
      saveAudioPrefs(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const t = setInterval(() => setCpu(cpuReading()), 250);
    return () => clearInterval(t);
  }, []);
  useEffect(() => audioEngine.onLatencyChange(() => setLatencyTick((n) => n + 1)), []);

  // The devices' rates, checked each time the panel opens (the device may
  // have changed).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void audioEngine.getDeviceRates().then((rates) => !cancelled && setDeviceRates(rates));
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  useShortcuts("menu", [{ keys: "escape", run: () => setOpen(false), whileTyping: true }], { enabled: open });

  const runMeasure = async () => {
    setMeasure({ state: "running" });
    try {
      const rt = await audioEngine.measureRoundTrip();
      if (rt === null) {
        setMeasure({
          state: "failed",
          message: "Couldn't hear the clicks clearly. Turn the speakers up (or connect the output to the input with a cable), keep the room quiet, and try again.",
        });
        return;
      }
      update({ measuredRoundTrip: rt });
      setMeasure({ state: "done", message: `Measured ${ms(rt)}. Recordings will be lined up using it.` });
    } catch {
      setMeasure({ state: "failed", message: "Couldn't open the audio input - check the browser's microphone permission." });
    }
  };

  const info = audioEngine.getLatencyInfo();
  const roundTrip = audioEngine.getRoundTrip();
  const load = cpu?.average ?? 0;
  const pct = cpu ? `${Math.round(load * 100)}%` : "–";

  return (
    <div ref={rootRef} className="relative ml-auto">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Audio engine load and latency"
        className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted hover:bg-surface-raised"
      >
        <Cpu size={13} />
        <span className="font-mono text-foreground">CPU {pct}</span>
        <span className="h-1.5 w-10 overflow-hidden rounded-full" style={{ background: "#2E2F37" }}>
          <span className="block h-full" style={{ width: `${Math.min(100, load * 100)}%`, background: loadColor(load) }} />
        </span>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 flex w-[360px] flex-col gap-3 rounded-xl p-4 shadow-2xl"
          style={{ background: "#1B1C22", border: "1px solid #2E2F37" }}
          role="dialog"
          aria-label="Audio settings"
        >
          <section className="flex flex-col gap-1.5">
            <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
              <Cpu size={12} /> CPU
            </h3>
            <Row label="Audio engine load" value={cpu ? `${Math.round(load * 100)}%` : "idle"} />
            <Row label="Peak (last few seconds)" value={cpu ? `${Math.round(cpu.peak * 100)}%` : "–"} />
            <p className="text-[11px] leading-snug text-muted">
              The share of real time the browser spends rendering the project&apos;s audio. Near 100% it can&apos;t keep up and
              you&apos;ll hear crackles - remove or bypass heavy effects (NAM Amp, Multiband).
            </p>
          </section>

          <section className="flex flex-col gap-1.5 border-t border-border pt-3">
            <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
              <Timer size={12} /> Latency
            </h3>
            <Row label="Sample rate" value={`${(info.sampleRate / 1000).toFixed(1)} kHz`} />
            {deviceRates?.output && (
              <Row label="Output device rate" value={`${(deviceRates.output / 1000).toFixed(1)} kHz`} title="The rate your speakers or interface run at, as set in the system's sound settings." />
            )}
            {deviceRates?.input && (
              <Row label="Input device rate" value={`${(deviceRates.input / 1000).toFixed(1)} kHz`} title="The rate your microphone or interface input runs at." />
            )}
            {[deviceRates?.output, deviceRates?.input].some((r) => r && r !== info.sampleRate) && (
              <p className="rounded border border-[#E6AD5E]/40 bg-[#E6AD5E]/10 px-2 py-1.5 text-[11px] leading-snug text-[#E6AD5E]">
                Your audio device runs at a different rate than Dawn ({(info.sampleRate / 1000).toFixed(1)} kHz), so the browser
                converts the audio on the way in and out, which adds delay. Set the device to {(info.sampleRate / 1000).toFixed(1)} kHz
                (on Windows: Sound settings → the device → Properties → Advanced, for both the output and the input), then reload.
              </p>
            )}
            <Row label="Output (engine → speakers)" value={ms(info.output)} title="The browser's audio buffer plus the device's." />
            <Row label="Input (mic → engine)" value={info.input ? ms(info.input) : "unknown"} title="As the browser reports it - it may not know all of it." />
            <Row
              label={roundTrip.measured ? "Round trip (measured)" : "Round trip (estimated)"}
              value={ms(roundTrip.seconds)}
            />
            <Row label="Effect delay being compensated" value={ms(info.compensated)} title="The most latent track/bus effects chain, which the others wait for." />
            <Row label="Mix → output (incl. master)" value={ms(info.effects)} />
            <p className="text-[11px] leading-snug text-muted">
              What you hear live always lags by the round trip - a browser can&apos;t go below its audio buffer. Use wired
              headphones or speakers (Bluetooth adds 100+ ms), and close other audio apps.
            </p>
          </section>

          <section className="flex flex-col gap-2.5 border-t border-border pt-3">
            <Toggle
              label="Delay compensation"
              hint="Delays tracks so effects that look ahead (Limiter, Compressor, Pitch Shift, oversampled Distortion) don't put their track behind the rest."
              value={prefs.delayCompensation}
              onChange={(v) => update({ delayCompensation: v })}
            />
            <Toggle
              label="Reduced latency when monitoring"
              hint="Tracks you're playing live (monitored, or the armed MIDI track) skip that delay so they respond right away."
              value={prefs.reducedLatencyMonitoring}
              onChange={(v) => update({ reducedLatencyMonitoring: v })}
            />
          </section>

          <section className="flex flex-col gap-2 border-t border-border pt-3">
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted">Recording</h3>
            <p className="text-[11px] leading-snug text-muted">
              Recordings are moved earlier by the round trip ({ms(roundTrip.seconds + info.effects)} in all) so they land on
              the beat you played to. Measuring makes that exact for your setup.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={runMeasure}
                disabled={measure.state === "running"}
                className="rounded-md border border-border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-foreground hover:bg-surface-raised disabled:opacity-50"
              >
                {measure.state === "running" ? "Listening…" : "Measure latency"}
              </button>
              {prefs.measuredRoundTrip !== null && (
                <button
                  type="button"
                  onClick={() => {
                    update({ measuredRoundTrip: null });
                    setMeasure({ state: "idle" });
                  }}
                  className="text-[11px] text-muted underline hover:text-foreground"
                >
                  Use estimate instead
                </button>
              )}
            </div>
            <p className="text-[11px] leading-snug text-muted">
              {measure.message ??
                "Plays 5 clicks and listens for them: point your speakers at the mic, or connect the interface's output to its input. Not with headphones on - it's loud."}
            </p>
            <label className="flex items-center justify-between gap-3 text-[12px]">
              <span className="flex flex-col">
                <span className="text-foreground">Recording offset</span>
                <span className="text-[11px] text-muted">Fine-tune by ear: positive moves takes earlier.</span>
              </span>
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  step={0.5}
                  min={-500}
                  max={500}
                  value={offsetDraft}
                  onChange={(e) => setOffsetDraft(e.target.value)}
                  onBlur={() => {
                    const v = Number(offsetDraft);
                    const next = Number.isFinite(v) ? Math.max(-500, Math.min(500, v)) : 0;
                    setOffsetDraft(String(next));
                    update({ recordingOffsetMs: next });
                  }}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  aria-label="Recording offset in milliseconds"
                  className="w-20 rounded border border-border bg-surface-raised px-2 py-1 text-right font-mono text-foreground"
                />
                <span className="text-muted">ms</span>
              </span>
            </label>
          </section>
        </div>
      )}
    </div>
  );
}
