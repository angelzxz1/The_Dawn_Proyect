"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AudioLines } from "lucide-react";
import { nativeBridge, type AudioDriver } from "@/engine/native/bridge";
import { nativeEngine } from "@/engine/native/nativeEngine";
import { unsupported } from "@/engine/native/describe";
import type { AudioPrefs } from "@/engine/audioPrefs";
import { useProjectDoc } from "@/state/projectStore";
import { noteIssue } from "@/services/issues";

const BUFFER_SIZES = [32, 64, 128, 256, 512, 1024, 2048];

const selectClass = "w-full rounded border border-border bg-surface-raised px-2 py-1 text-[12px] text-foreground disabled:opacity-50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 text-[12px]">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="w-[200px]">{children}</span>
    </label>
  );
}

/** Turns the native engine on and off as the settings say (in the desktop
 * app), and opens the device again when they change. */
export function useNativeEngine(prefs: AudioPrefs, available: boolean): void {
  const { nativeEngine: on, nativeDevice, nativeSampleRate, nativeBufferSize } = prefs;
  useEffect(() => {
    if (!available) return;
    if (on) void nativeEngine.turnOn({ device: nativeDevice, sampleRate: nativeSampleRate, bufferSize: nativeBufferSize });
    else if (nativeEngine.current.active) void nativeEngine.turnOff();
  }, [available, on, nativeDevice, nativeSampleRate, nativeBufferSize]);
}

/** The Audio panel's native engine section (desktop app only): on or off,
 * the driver and device, the rate and buffer size, how it's running, and
 * what of the project it doesn't play yet. */
export function NativeEngineSection({ prefs, update }: { prefs: AudioPrefs; update: (change: Partial<AudioPrefs>) => void }) {
  const state = useSyncExternalStore(nativeEngine.subscribe, () => nativeEngine.current, () => nativeEngine.current);
  const doc = useProjectDoc();
  const [drivers, setDrivers] = useState<AudioDriver[] | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    nativeBridge.devices().then(
      (list) => !cancelled && setDrivers(list),
      (error) => {
        noteIssue("native.devices", error);
        if (!cancelled) setDrivers([]);
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const deviceDriver = drivers?.find((d) => d.devices.some((dev) => dev.id === prefs.nativeDevice));
  const driver = drivers?.find((d) => d.id === (driverId ?? deviceDriver?.id)) ?? drivers?.[0];
  const device = driver?.devices.find((d) => d.id === prefs.nativeDevice) ?? driver?.devices.find((d) => d.isDefault) ?? driver?.devices[0];
  const buffers = BUFFER_SIZES.filter((b) => (device?.minBuffer ?? 0) <= b && b <= (device?.maxBuffer ?? Infinity));
  const missing = unsupported(doc);
  const status = state.status;
  const bufferMs = state.bufferSize && state.sampleRate ? ` (${((state.bufferSize / state.sampleRate) * 1000).toFixed(1)} ms)` : "";

  return (
    <section className="flex flex-col gap-2 border-b border-border pb-3">
      <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
        <AudioLines size={12} /> Audio engine
      </h3>
      <label className="flex cursor-pointer items-start justify-between gap-3">
        <span className="flex flex-col">
          <span className="text-[12px] text-foreground">Native engine (beta)</span>
          <span className="text-[11px] leading-snug text-muted">
            Plays through your audio interface&apos;s own driver (Core Audio, WASAPI) instead of the browser&apos;s audio.
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={prefs.nativeEngine}
          aria-label="Native engine"
          onClick={() => update({ nativeEngine: !prefs.nativeEngine })}
          className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors"
          style={{ background: prefs.nativeEngine ? "#E6AD5E" : "#2E2F37" }}
        >
          <span className="absolute top-0.5 h-4 w-4 rounded-full bg-[#F4EDE2] transition-all" style={{ left: prefs.nativeEngine ? 18 : 2 }} />
        </button>
      </label>

      {prefs.nativeEngine && (
        <>
          <Field label="Driver">
            <select
              className={selectClass}
              aria-label="Driver"
              value={driver?.id ?? ""}
              disabled={!drivers?.length}
              onChange={(e) => {
                setDriverId(e.target.value);
                const next = drivers?.find((d) => d.id === e.target.value);
                const dev = next?.devices.find((d) => d.isDefault) ?? next?.devices[0];
                update({ nativeDevice: dev?.id ?? null, nativeSampleRate: null, nativeBufferSize: null });
              }}
            >
              {drivers === null && <option>Looking…</option>}
              {drivers?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Device">
            <select
              className={selectClass}
              aria-label="Device"
              value={device?.id ?? ""}
              disabled={!driver?.devices.length}
              onChange={(e) => update({ nativeDevice: e.target.value, nativeSampleRate: null, nativeBufferSize: null })}
            >
              {driver?.devices.length === 0 && <option>No devices</option>}
              {driver?.devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sample rate">
            <select
              className={selectClass}
              aria-label="Sample rate"
              value={prefs.nativeSampleRate ?? ""}
              onChange={(e) => update({ nativeSampleRate: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">Device&apos;s own{device?.defaultSampleRate ? ` (${device.defaultSampleRate / 1000} kHz)` : ""}</option>
              {device?.sampleRates.map((r) => (
                <option key={r} value={r}>
                  {r / 1000} kHz
                </option>
              ))}
            </select>
          </Field>
          <Field label="Buffer size">
            <select
              className={selectClass}
              aria-label="Buffer size"
              value={prefs.nativeBufferSize ?? ""}
              onChange={(e) => update({ nativeBufferSize: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">Device&apos;s own</option>
              {buffers.map((b) => (
                <option key={b} value={b}>
                  {b} samples
                </option>
              ))}
            </select>
          </Field>

          {state.error ? (
            <p className="rounded border border-[#FF6B6B]/40 bg-[#FF6B6B]/10 px-2 py-1.5 text-[11px] leading-snug text-[#FF6B6B]">
              Couldn&apos;t open the device: {state.error}
            </p>
          ) : state.starting ? (
            <p className="text-[11px] text-muted">Opening the device…</p>
          ) : (
            state.active && (
              <p className="font-mono text-[11px] text-foreground" aria-label="Native engine status">
                {(state.sampleRate / 1000).toFixed(1)} kHz{state.bufferSize ? ` · ${state.bufferSize} samples${bufferMs}` : ""} · load{" "}
                {Math.round((status?.load ?? 0) * 100)}% · {status?.errors ?? 0} dropouts
              </p>
            )
          )}

          <p className="text-[11px] leading-snug text-muted">
            So far it plays audio clips and every instrument (the piano, the Drum Rack and the synth, from clips and the keys you
            play) through the mix (volume, pan, mute, solo, groups, sends), the dynamics and EQ effects (Compressor, Glue
            Compressor, Noise Gate, Limiter, the multiband effects, Parametric EQ, Utility), the Pitch Shift and the Furnace amp,
            with delay compensation, the master limiter and the metronome. The other effects, sidechains, automation and
            recording come next: until then, turn it off for those.
          </p>
          {(missing.instruments.length > 0 || missing.effects.length > 0 || missing.automation.length > 0) && (
            <ul className="rounded border border-[#E6AD5E]/40 bg-[#E6AD5E]/10 px-2 py-1.5 text-[11px] leading-snug text-[#E6AD5E]">
              {missing.instruments.length > 0 && <li>Silent here: the instruments on {missing.instruments.join(", ")}.</li>}
              {missing.effects.length > 0 && <li>Played without: {missing.effects.join(", ")}.</li>}
              {missing.automation.length > 0 && <li>Without their automation: {missing.automation.join(", ")}.</li>}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
