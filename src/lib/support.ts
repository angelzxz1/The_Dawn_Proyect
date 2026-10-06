// Where "Support Dawn" and "Feedback" go. The pages are set per deployment
// with environment variables (docs/deploy.md): a button only shows once its
// page exists. Feedback always works - without a form it opens a GitHub
// issue - and arrives with the browser and Dawn's version filled in.

export interface SupportLink {
  id: "patreon" | "github" | "kofi" | "discord";
  label: string;
  url: string;
  hint: string;
}

const env = {
  patreon: process.env.NEXT_PUBLIC_PATREON_URL ?? "",
  github: process.env.NEXT_PUBLIC_GITHUB_SPONSORS_URL ?? "",
  kofi: process.env.NEXT_PUBLIC_KOFI_URL ?? "",
  discord: process.env.NEXT_PUBLIC_DISCORD_URL ?? "",
  feedback: process.env.NEXT_PUBLIC_FEEDBACK_URL ?? "",
  version: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
};

const https = (u: string) => (/^https:\/\//.test(u) ? u : "");

/** The support pages this deployment has, most important first. */
export function supportLinks(): SupportLink[] {
  const all: SupportLink[] = [
    { id: "patreon", label: "Patreon", url: https(env.patreon), hint: "Monthly support, packs and early access" },
    { id: "github", label: "GitHub Sponsors", url: https(env.github), hint: "Sponsor from your GitHub account" },
    { id: "kofi", label: "Ko-fi", url: https(env.kofi), hint: "A one-time tip" },
  ];
  return all.filter((l) => l.url);
}

export function communityLink(): SupportLink | null {
  const url = https(env.discord);
  return url ? { id: "discord", label: "Discord", url, hint: "Share demos, get help, suggest features" } : null;
}

export const ISSUES_URL = "https://github.com/angelzxz1/The_Dawn_Proyect/issues";

/** "Chrome 141 on Windows" from a user-agent string. */
export function describeBrowser(ua: string): string {
  const browser =
    (/Edg\/(\d+)/.exec(ua) && `Edge ${/Edg\/(\d+)/.exec(ua)![1]}`) ||
    (/OPR\/(\d+)/.exec(ua) && `Opera ${/OPR\/(\d+)/.exec(ua)![1]}`) ||
    (/Firefox\/(\d+)/.exec(ua) && `Firefox ${/Firefox\/(\d+)/.exec(ua)![1]}`) ||
    (/Chrome\/(\d+)/.exec(ua) && `Chrome ${/Chrome\/(\d+)/.exec(ua)![1]}`) ||
    (/Version\/(\d+)[\d.]* Safari/.exec(ua) && `Safari ${/Version\/(\d+)/.exec(ua)![1]}`) ||
    "Unknown browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Android/.test(ua)
          ? "Android"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "an unknown system";
  return `${browser} on ${os}`;
}

/** The feedback page with the browser and version filled in: the
 * deployment's form (as query parameters a form tool can prefill from),
 * or a new GitHub issue. */
export function feedbackUrl(ua: string, brave = false, problems = ""): string {
  const browser = `${describeBrowser(ua)}${brave ? " (Brave)" : ""}`;
  const form = https(env.feedback);
  if (form) {
    const url = new URL(form);
    url.searchParams.set("browser", browser);
    url.searchParams.set("version", env.version);
    if (problems) url.searchParams.set("problems", problems);
    return url.toString();
  }
  const body = `**What happened, or what would you like?**\n\n\n\n---\nDawn ${env.version} · ${browser}${problems ? `\nRecent problems: ${problems}` : ""}`;
  return `${ISSUES_URL}/new?${new URLSearchParams({ title: "Feedback: ", body }).toString()}`;
}

const POST_EXPORT_KEY = "dawn.supportAsked";

/** Whether to show the thank-you after an export: once per visit, only when there's somewhere to support. */
export function shouldAskAfterExport(): boolean {
  if (supportLinks().length === 0) return false;
  try {
    if (sessionStorage.getItem(POST_EXPORT_KEY)) return false;
    sessionStorage.setItem(POST_EXPORT_KEY, "1");
  } catch {
    // Without session storage it may ask again after a reload; fine.
  }
  return true;
}
