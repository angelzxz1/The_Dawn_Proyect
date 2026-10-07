"use client";

import { useState } from "react";
import { Download, X } from "lucide-react";
import { clearRecoveryNotice, downloadLatestBackup, readRecoveryNotice } from "@/project/projectRecovery";

/** Shown when the last saved project couldn't be opened and the studio
 * started fresh: the old project is kept as a backup in this browser,
 * which can be downloaded from here. */
export function RecoveryNotice() {
  const [reason, setReason] = useState<string | null>(() => readRecoveryNotice());
  const [downloadFailed, setDownloadFailed] = useState(false);
  if (!reason) return null;
  return (
    <div
      role="alert"
      className="fixed left-1/2 top-3 z-[90] flex w-[min(640px,calc(100vw-32px))] -translate-x-1/2 items-start gap-3 rounded-lg border border-border bg-surface-raised p-3 text-sm shadow-2xl"
    >
      <div className="flex-1">
        <p className="font-medium">The studio started with a fresh project.</p>
        <p className="mt-1 text-xs text-muted">
          {reason} A backup of it is kept in this browser.
          {downloadFailed && " (No backup was found to download.)"}
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          void downloadLatestBackup()
            .then((found) => setDownloadFailed(!found))
            .catch(() => setDownloadFailed(true));
        }}
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-surface"
      >
        <Download size={13} />
        Download backup
      </button>
      <button
        type="button"
        title="Dismiss"
        onClick={() => {
          clearRecoveryNotice();
          setReason(null);
        }}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:bg-surface"
      >
        <X size={14} />
      </button>
    </div>
  );
}
