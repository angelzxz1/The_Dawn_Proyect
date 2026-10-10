"use client";

import { useEffect, useState } from "react";

/** Shown instead of Next's bare "This page couldn't load" when the studio
 * crashes while rendering - most likely from a saved project it can't
 * handle. Offers a retry, or a fresh start that keeps the saved project
 * (and its audio) as a backup in this browser. */
export default function StudioError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const [resetting, setResetting] = useState(false);
  const [resetFailed, setResetFailed] = useState(false);

  useEffect(() => {
    console.error(error);
    // Loaded on demand, like the recovery code below.
    void import("@/services/telemetry").then((t) => {
      t.startTelemetry();
      t.reportError(error, "crash");
      t.track("error_shown", { area: "crash" });
    });
  }, [error]);

  const startFresh = async () => {
    setResetting(true);
    try {
      // Loaded on demand so this fallback stays tiny and can't be broken by
      // the same code that just crashed.
      const { startFreshKeepingBackup } = await import("@/project/projectRecovery");
      await startFreshKeepingBackup(`The studio crashed: ${error.message || "unknown error"}.`);
    } catch {
      setResetting(false);
      setResetFailed(true);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-2xl">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-icon.png" alt="" className="h-6 w-6 rounded-md" />
          <h1 className="text-lg font-semibold tracking-tight">The studio hit a problem</h1>
        </div>
        <p className="mt-3 text-sm text-muted">
          Something went wrong while opening The Dawn Project. This is usually caused by a saved project the
          current version can&apos;t read.
        </p>
        {error.message && (
          <p className="mt-3 break-words rounded-md bg-background px-3 py-2 font-mono text-xs text-muted">
            {error.message}
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => retry()}
            disabled={resetting}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-raised disabled:opacity-50"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => void startFresh()}
            disabled={resetting}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {resetting ? "Starting fresh…" : "Start with a fresh project"}
          </button>
        </div>
        <p className="mt-3 text-xs text-muted">
          Starting fresh keeps a backup of your current project in this browser - you can download it from the
          notice that appears afterwards.
        </p>
        {resetFailed && (
          <p className="mt-2 text-xs text-record">
            Couldn&apos;t reset the saved project. Try reloading the page.
          </p>
        )}
      </div>
    </div>
  );
}
