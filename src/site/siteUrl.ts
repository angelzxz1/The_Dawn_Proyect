/** The site's own address (NEXT_PUBLIC_SITE_URL, set when deploying; see
 * docs/deploy.md), without a trailing slash. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
