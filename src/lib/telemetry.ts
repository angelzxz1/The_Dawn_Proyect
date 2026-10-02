// Usage statistics and error reports, set up for the deployment through
// environment variables (see docs/deploy.md); with none set, nothing is
// loaded or sent. Only actions are counted ("an MP3 was exported"), never
// content: event properties are a fixed set of short codes, and error
// messages have file names stripped. Anyone can switch it off in
// About → Privacy, and it stays off when the browser asks sites not to
// track (Do Not Track / Global Privacy Control).

export type TelemetryEvent =
  | "app_opened"
  | "template_chosen"
  | "sound_made"
  | "recording_started"
  | "nam_model_loaded"
  | "ir_loaded"
  | "export_completed"
  | "project_saved"
  | "pack_imported"
  | "support_link_clicked"
  | "feedback_opened"
  | "error_shown";

/** The only properties an event may carry, each a short code or number. */
export type TelemetryProps = Partial<Record<"kind" | "format" | "via" | "target" | "area" | "template" | "returning" | "where", string | number | boolean>>;

const ALLOWED_PROPS = new Set(["kind", "format", "via", "target", "area", "template", "returning", "where"]);
const CODE = /^[a-z0-9][a-z0-9_.-]{0,31}$/i;

/** Drops any property that isn't one of the known keys holding a short code,
 * so a name or path can never slip into an event. */
export function cleanProps(props: Record<string, unknown> | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!props) return out;
  for (const [k, v] of Object.entries(props)) {
    if (!ALLOWED_PROPS.has(k)) continue;
    if (typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) out[k] = v;
    else if (typeof v === "string" && CODE.test(v)) out[k] = v;
  }
  return out;
}

const FILE_NAME = /[^\s"'`/\\:()]+\.(wav|wave|mp3|flac|ogg|oga|opus|aif|aiff|m4a|aac|webm|nam|json|mid|midi|dawnproject|dawnpack|zip)\b/gi;
const QUOTED = /(["“'`])[^"”'`]{1,200}\1/g;

/** An error message with file names and quoted text replaced, shortened. */
export function scrubMessage(message: string): string {
  return message.replace(FILE_NAME, "<file>").replace(QUOTED, "$1…$1").slice(0, 300);
}

// --- configuration and consent ---

const env = {
  cfBeacon: process.env.NEXT_PUBLIC_CF_BEACON_TOKEN ?? "",
  umamiId: process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID ?? "",
  umamiSrc: process.env.NEXT_PUBLIC_UMAMI_SRC || "https://cloud.umami.is/script.js",
  plausibleDomain: process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ?? "",
  plausibleSrc: process.env.NEXT_PUBLIC_PLAUSIBLE_SRC || "https://plausible.io/js/script.manual.js",
  sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? "",
  version: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
};

/** Whether this deployment has any statistics or error reporting set up. */
export const telemetryConfigured = !!(env.cfBeacon || env.umamiId || env.plausibleDomain || env.sentryDsn);

const CONSENT_KEY = "dawn.telemetry";
const SEEN_KEY = "dawn.seen";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows can refuse storage; the choice then lasts this visit.
  }
}

/** The browser asks sites not to track. */
export function browserOptedOut(): boolean {
  if (typeof navigator === "undefined") return false;
  const n = navigator as Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string | null };
  return n.globalPrivacyControl === true || n.doNotTrack === "1";
}

let sessionChoice: boolean | null = null;
const listeners = new Set<() => void>();

/** The person's choice: on unless they switched it off or the browser opts out. */
export function telemetryEnabled(): boolean {
  if (sessionChoice !== null) return sessionChoice;
  const stored = readStorage(CONSENT_KEY);
  if (stored === "off") return false;
  if (stored === "on") return true;
  return !browserOptedOut();
}

export function setTelemetryEnabled(on: boolean) {
  sessionChoice = on;
  writeStorage(CONSENT_KEY, on ? "on" : "off");
  if (on) startTelemetry();
  listeners.forEach((l) => l());
}

export function subscribeTelemetry(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const active = () => telemetryConfigured && typeof window !== "undefined" && telemetryEnabled();

// --- providers ---

type Win = Window & {
  umami?: { track: (name: string, data?: Record<string, unknown>) => void };
  plausible?: ((name: string, opts?: { props?: Record<string, unknown> }) => void) & { q?: unknown[] };
};

function addScript(src: string, attrs: Record<string, string>) {
  const s = document.createElement("script");
  s.src = src;
  s.defer = true;
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  document.head.appendChild(s);
}

let started = false;
const pending: [TelemetryEvent, Record<string, string | number | boolean>][] = [];

/** Loads the configured providers, once, if the person allows it. */
export function startTelemetry() {
  if (started || !active()) return;
  started = true;
  if (env.cfBeacon) addScript("https://static.cloudflareinsights.com/beacon.min.js", { "data-cf-beacon": JSON.stringify({ token: env.cfBeacon }) });
  if (env.umamiId) addScript(env.umamiSrc, { "data-website-id": env.umamiId, "data-do-not-track": "true" });
  if (env.plausibleDomain) {
    const w = window as Win;
    // Plausible's queue stub, so events sent before the script loads aren't lost.
    w.plausible = w.plausible || Object.assign((...args: unknown[]) => (w.plausible!.q = w.plausible!.q || []).push(args), { q: [] as unknown[] });
    addScript(env.plausibleSrc, { "data-domain": env.plausibleDomain });
    w.plausible("pageview");
  }
  if (env.sentryDsn) installErrorReporting();
  flush();
}

function flush() {
  const w = window as Win;
  // Umami defines its tracker when its script runs: wait for it.
  if (env.umamiId && !w.umami) {
    if (pending.length) setTimeout(flush, 1000);
    return;
  }
  for (const [name, props] of pending.splice(0)) {
    if (env.umamiId) w.umami?.track(name, props);
    if (env.plausibleDomain) w.plausible?.(name, { props });
  }
}

/** Counts an action. Properties must be short codes ("mp3", "audio"): anything else is dropped. */
export function track(event: TelemetryEvent, props?: TelemetryProps) {
  if (!active() || !(env.umamiId || env.plausibleDomain)) return;
  pending.push([event, cleanProps(props)]);
  if (pending.length > 50) pending.shift();
  if (started) flush();
}

const once = new Set<string>();
/** Counts an action only the first time it happens in this visit. */
export function trackOnce(event: TelemetryEvent, props?: TelemetryProps) {
  if (once.has(event)) return;
  once.add(event);
  track(event, props);
}

/** Counts the visit, noting whether this browser has opened Dawn before. */
export function trackAppOpened() {
  const returning = readStorage(SEEN_KEY) !== null;
  writeStorage(SEEN_KEY, "1");
  trackOnce("app_opened", { returning });
}

// --- error reports (Sentry's envelope API, without its SDK) ---

interface Dsn {
  url: string;
  key: string;
}

export function parseDsn(dsn: string): Dsn | null {
  const m = /^(https?):\/\/([^@/]+)@([^/]+)\/(?:(.*)\/)?(\d+)$/.exec(dsn.trim());
  if (!m) return null;
  const [, scheme, key, host, path, project] = m;
  return { url: `${scheme}://${host}/${path ? `${path}/` : ""}api/${project}/envelope/?sentry_key=${key}&sentry_version=7`, key };
}

interface Frame {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
}

/** Stack frames from a V8 or Firefox/Safari stack, outermost first (Sentry's order). */
export function parseStack(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const line of stack.split("\n").slice(0, 30)) {
    const v8 = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    const gecko = /^(.*?)@(.+?):(\d+):(\d+)$/.exec(line);
    const m = v8 ?? gecko;
    if (!m) continue;
    frames.push({ function: m[1] || "?", filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) });
  }
  return frames.reverse();
}

const reported = new Set<string>();
let reportCount = 0;
const MAX_REPORTS = 10;

function environment(): string {
  const host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return "development";
  return host.endsWith(".pages.dev") ? "preview" : "production";
}

/** Sends an error report (if set up and allowed). `where` is a short code for the part of Dawn. */
export function reportError(error: unknown, where = "app") {
  if (!active() || !env.sentryDsn) return;
  const dsn = parseDsn(env.sentryDsn);
  if (!dsn) return;
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Unknown error");
  const message = scrubMessage(err.message || String(err));
  const frames = parseStack(err.stack);
  const fingerprint = `${err.name}:${message}:${frames.at(-1)?.filename}:${frames.at(-1)?.lineno}`;
  if (reported.has(fingerprint) || reportCount >= MAX_REPORTS) return;
  reported.add(fingerprint);
  reportCount++;
  const eventId = crypto.randomUUID().replace(/-/g, "");
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: "error",
    release: `dawn@${env.version}`,
    environment: environment(),
    tags: { where: CODE.test(where) ? where : "app" },
    exception: { values: [{ type: err.name || "Error", value: message, stacktrace: frames.length ? { frames } : undefined }] },
    // Only the page's address without its query, and the browser string, so Sentry can tell browsers and systems apart.
    request: { url: location.origin + location.pathname, headers: { "User-Agent": navigator.userAgent } },
  };
  const body = `${JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}\n`;
  void fetch(dsn.url, { method: "POST", body, keepalive: true }).catch(() => {});
}

let errorsInstalled = false;
function installErrorReporting() {
  if (errorsInstalled) return;
  errorsInstalled = true;
  window.addEventListener("error", (e) => reportError(e.error ?? e.message, "window"));
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason, "promise"));
}
