// Where "Support Dawn" and "Feedback" go. The pages are set per deployment
// with environment variables (docs/deploy.md): a button only shows once its
// page exists. Feedback, bug reports and ideas all go to Dawn's Discord,
// with the browser and Dawn's version ready to paste (feedbackDetails).

export interface SupportLink {
  id: "patreon" | "kofi" | "discord";
  label: string;
  url: string;
  hint: string;
}

const env = {
  patreon: process.env.NEXT_PUBLIC_PATREON_URL ?? "",
  kofi: process.env.NEXT_PUBLIC_KOFI_URL ?? "",
  discord: process.env.NEXT_PUBLIC_DISCORD_URL ?? "",
  contact: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "",
  version: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
};

const https = (u: string) => (/^https:\/\//.test(u) ? u : "");

/** The support pages this deployment has, most important first. */
export function supportLinks(): SupportLink[] {
  const all: SupportLink[] = [
    { id: "patreon", label: "Patreon", url: https(env.patreon), hint: "Monthly support, packs and early access" },
    { id: "kofi", label: "Ko-fi", url: https(env.kofi), hint: "A one-time tip" },
  ];
  return all.filter((l) => l.url);
}

/** Where memberships are run, for "Memberships run on ...": Patreon (its
 * button reads "opening soon" until its page is set). Ko-fi is for one-time
 * tips, so it isn't one. */
export function membershipPlatforms(): string[] {
  return ["Patreon"];
}

export function communityLink(): SupportLink | null {
  const url = https(env.discord);
  return url ? { id: "discord", label: "Discord", url, hint: "Share demos, get help, suggest features" } : null;
}

/** The address people can write to (tone creators, press), or "" until
 * this deployment sets one. */
export function contactEmail(): string {
  return /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(env.contact) ? env.contact : "";
}

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

/** What to paste into a Discord post about a problem or an idea: Dawn's
 * version, the browser, and any problems Dawn noted lately. (A Discord
 * invite can't carry text, so the feedback window offers to copy it.) */
export function feedbackDetails(ua: string, brave = false, problems = ""): string {
  const browser = `${describeBrowser(ua)}${brave ? " (Brave)" : ""}`;
  return `Dawn ${env.version} · ${browser}${problems ? `\nRecent problems: ${problems}` : ""}`;
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
