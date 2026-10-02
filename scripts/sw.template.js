// Dawn's service worker (generated into public/sw.js by scripts/build-sw.mjs
// at build time, with this build's id). It makes the installed app open
// offline and load faster:
// - pages: network first, falling back to the cached app shell offline;
// - hashed build files (/_next/static): cached forever once used;
// - everything else Dawn fetches (the amp engine, piano samples, tones):
//   cached as it's used, refreshed in the background.
// Nothing is downloaded up front beyond the shell, so installing stays light.
// A new build installs alongside and waits; the page offers "reload" and
// sends SKIP_WAITING when the person accepts.

const BUILD = "__BUILD_ID__";
const SHELL = `dawn-shell-${BUILD}`;
const ASSETS = "dawn-assets-v1"; // hashed, so safe across builds
const RUNTIME = `dawn-runtime-${BUILD}`;
const SHELL_URLS = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/logo-icon.png"];
// Cross-origin files worth keeping offline (the piano's samples).
const CACHEABLE_ORIGINS = ["https://tonejs.github.io"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_URLS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, ASSETS, RUNTIME]);
      for (const key of await caches.keys()) if (key.startsWith("dawn-") && !keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
  // The page lists what it loaded before this worker controlled it.
  if (event.data && event.data.type === "CACHE_URLS") {
    event.waitUntil(Promise.all(event.data.urls.map((u) => cacheIfMissing(u).catch(() => {}))));
  }
});

function cacheFor(url) {
  return url.pathname.startsWith("/_next/static/") ? ASSETS : RUNTIME;
}

async function cacheIfMissing(href) {
  const url = new URL(href, self.location.origin);
  if (!cacheable(url)) return;
  const cache = await caches.open(cacheFor(url));
  if (await cache.match(url.href)) return;
  const res = await fetch(url.href, { mode: url.origin === self.location.origin ? "same-origin" : "cors" });
  if (res.ok) await cache.put(url.href, res);
}

function cacheable(url) {
  if (url.origin === self.location.origin) return !url.pathname.startsWith("/sw.js");
  return CACHEABLE_ORIGINS.includes(url.origin);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!cacheable(url)) return;

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) (await caches.open(SHELL)).put("/", res.clone());
          return res;
        } catch {
          return (await caches.match(req)) || (await caches.match("/")) || Response.error();
        }
      })()
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok) (await caches.open(ASSETS)).put(req, res.clone());
        return res;
      })()
    );
    return;
  }

  // Stale while revalidate.
  event.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached || Response.error());
      return cached || network;
    })()
  );
});
