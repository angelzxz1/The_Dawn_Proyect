import type { MetadataRoute } from "next";

// Makes Dawn installable (Chrome and Edge offer "Install"): its own window,
// an app icon, and - with the service worker (scripts/build-sw.mjs) - it
// opens offline.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "The Dawn Project",
    short_name: "Dawn",
    description: "A studio in a tab: record, amp up your guitar, make beats and finish your demo.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#131316",
    theme_color: "#131316",
    categories: ["music", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
