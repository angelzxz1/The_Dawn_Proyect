import { backupProject, clearSavedProject, latestBackup, loadProject } from "./persistence";
import { noteIssue } from "./issues";

const NOTICE_KEY = "dawn-recovery-notice";

/** Backs up the saved project (with its audio), clears it, and reloads so
 * the studio starts on a fresh project. The reason is shown once after the
 * reload. Used when a saved project can't be opened or crashes the app. */
export async function startFreshKeepingBackup(reason: string): Promise<void> {
  try {
    const saved = await loadProject();
    if (saved) await backupProject(saved.raw, saved.blobs, reason);
  } catch {
    // Nothing readable to back up - still start fresh rather than crash again.
  }
  await clearSavedProject().catch((error) => noteIssue("recovery.clear", error));
  try {
    sessionStorage.setItem(NOTICE_KEY, reason);
  } catch {
    // Private mode etc. - the fresh start still happens, just without a notice.
  }
  window.location.reload();
}

/** The reason for a fresh start that just happened, if any. It stays until
 * dismissed (clearRecoveryNotice) so a reload doesn't lose it. */
export function readRecoveryNotice(): string | null {
  try {
    return sessionStorage.getItem(NOTICE_KEY);
  } catch {
    return null;
  }
}

export function clearRecoveryNotice(): void {
  try {
    sessionStorage.removeItem(NOTICE_KEY);
  } catch {
    // Nothing stored.
  }
}

/** Saves the latest backup's project data as a JSON file (audio stays in
 * the browser - the file lists which clips it had). */
export async function downloadLatestBackup(): Promise<boolean> {
  const backup = await latestBackup();
  if (!backup) return false;
  const file = {
    createdAt: new Date(backup.createdAt).toISOString(),
    reason: backup.reason,
    audioClipIds: backup.blobs.map(([id]) => id),
    project: backup.project,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `dawn-project-backup-${backup.createdAt}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}
