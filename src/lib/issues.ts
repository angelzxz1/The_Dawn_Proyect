// Problems the studio gets past on its own: a note that couldn't play, a
// waveform or effect file that didn't load, an autosave that failed. The
// user sees the outcome (a message, a missing waveform), but the cause used
// to be thrown away. Each is now noted here: logged to the console while
// developing, sent as a warning when error reporting is on (once per kind,
// see telemetry.ts), and kept in a short list.

import { reportError } from "./telemetry";

export interface Issue {
  /** Where it happened: a short code like "engine.note" or "autosave". */
  where: string;
  message: string;
  count: number;
  /** When it last happened (ms since the page loaded). */
  last: number;
}

const MAX_KINDS = 50;
const issues = new Map<string, Issue>();

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  return error === undefined ? "" : String(error);
}

const quiet = () => typeof process !== "undefined" && process.env.NODE_ENV === "test";
const developing = () => typeof process !== "undefined" && process.env.NODE_ENV === "development";

/** Notes a problem the studio got past. `report: false` for what isn't a
 * bug, only worth a log line: a file that isn't audio, a refused
 * microphone. */
export function noteIssue(where: string, error?: unknown, { report = true }: { report?: boolean } = {}): void {
  const message = messageOf(error);
  const key = `${where}|${message}`;
  let issue = issues.get(key);
  if (!issue) {
    if (issues.size >= MAX_KINDS) issues.delete(issues.keys().next().value!);
    issue = { where, message, count: 0, last: 0 };
    issues.set(key, issue);
  }
  issue.count++;
  issue.last = typeof performance !== "undefined" ? performance.now() : 0;
  // The first time, and then every hundredth: a broken note in a playing
  // loop shouldn't flood the console.
  if (developing() && !quiet() && (issue.count === 1 || issue.count % 100 === 0)) {
    console.warn(`[dawn] ${where}${issue.count > 1 ? ` (×${issue.count})` : ""}:`, error ?? "");
  }
  if (report && issue.count === 1) reportError(error ?? new Error(where), where, "warning");
}

/** The problems noted so far, most recent first. */
export function recentIssues(): Issue[] {
  return [...issues.values()].sort((a, b) => b.last - a.last);
}

/** The kinds of problems noted, with how often, for a feedback report -
 * just the codes ("clip.load ×2"), no messages (they can name files). */
export function issueSummary(max = 8): string {
  const counts = new Map<string, number>();
  recentIssues().forEach((i) => counts.set(i.where, (counts.get(i.where) ?? 0) + i.count));
  return [...counts]
    .slice(0, max)
    .map(([where, n]) => (n > 1 ? `${where} ×${n}` : where))
    .join(", ");
}

/** Runs `fn`; if it throws, notes it and carries on. */
export function attempt(where: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    noteIssue(where, error);
  }
}
