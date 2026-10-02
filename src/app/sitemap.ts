import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/siteUrl";

export const dynamic = "force-static";

/** The website's pages, for search engines. The studio (/app) is left out:
 * it's an app, not something to index. */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages: [string, number][] = [
    ["", 1],
    ["/features", 0.9],
    ["/how-it-works", 0.9],
    ["/faq", 0.8],
    ["/support", 0.7],
    ["/privacy", 0.3],
    ["/license", 0.3],
    ["/credits", 0.3],
  ];
  return pages.map(([path, priority]) => ({ url: `${SITE_URL}${path}`, changeFrequency: "monthly", priority }));
}
