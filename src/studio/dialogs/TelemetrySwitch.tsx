"use client";

import { useSyncExternalStore } from "react";
import { setTelemetryEnabled, subscribeTelemetry, telemetryConfigured, telemetryEnabled, browserOptedOut } from "@/services/telemetry";

/** The switch for usage statistics and error reports (About → Privacy). */
export function TelemetrySwitch() {
  const on = useSyncExternalStore(subscribeTelemetry, telemetryEnabled, () => false);
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface px-3 py-2.5">
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="text-[12.5px] text-foreground">Share anonymous usage statistics and error reports</span>
          <span className="text-[11px] leading-snug text-muted">
            Counts like &ldquo;an MP3 was exported&rdquo;, never your music, names or files.
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Share anonymous usage statistics and error reports"
          onClick={() => setTelemetryEnabled(!on)}
          className="relative h-5 w-9 shrink-0 rounded-full transition-colors"
          style={{ background: on ? "#E6AD5E" : "#2E2F37" }}
        >
          <span className="absolute top-0.5 h-4 w-4 rounded-full bg-[#F4EDE2] transition-all" style={{ left: on ? 18 : 2 }} />
        </button>
      </label>
      {!telemetryConfigured && <p className="text-[11px] text-muted">This copy of Dawn doesn&rsquo;t collect any statistics.</p>}
      {telemetryConfigured && browserOptedOut() && !on && (
        <p className="text-[11px] text-muted">Off because your browser asks sites not to track you.</p>
      )}
    </div>
  );
}
