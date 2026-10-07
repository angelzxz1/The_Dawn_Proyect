// Where the website's buttons go. The studio lives at /app; the support and
// community pages are set per deployment (docs/deploy.md), and a button whose
// page isn't set up yet isn't shown.

import { communityLink, ISSUES_URL, supportLinks, type SupportLink } from "../lib/support";

export const APP_PATH = "/app";
export const REPO_URL = "https://github.com/angelzxz1/The_Dawn_Proyect";
export { ISSUES_URL };

const https = (u: string | undefined) => (u && /^https:\/\//.test(u) ? u : "");

/** The 60-second demo video (a YouTube or similar page), once there is one. */
export const DEMO_VIDEO_URL = https(process.env.NEXT_PUBLIC_DEMO_VIDEO_URL);

export function supportLink(id: SupportLink["id"]): string {
  if (id === "discord") return communityLink()?.url ?? "";
  return supportLinks().find((l) => l.id === id)?.url ?? "";
}
