"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";

/** Registers the service worker (production builds only) that makes Dawn
 * installable and work offline, and offers "New version available: reload"
 * when a deploy lands. Never reloads on its own: unsaved work is the
 * person's call. */
export function AppUpdater() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const reloading = useRef(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let reg: ServiceWorkerRegistration | null = null;
    const watch = (r: ServiceWorkerRegistration) => {
      if (r.waiting && navigator.serviceWorker.controller) setWaiting(r.waiting);
      r.addEventListener("updatefound", () => {
        const next = r.installing;
        next?.addEventListener("statechange", () => {
          if (next.state === "installed" && navigator.serviceWorker.controller) setWaiting(next);
        });
      });
    };
    const onControllerChange = () => {
      if (!reloading.current) return;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    navigator.serviceWorker
      .register("/sw.js")
      .then((r) => {
        reg = r;
        watch(r);
        return navigator.serviceWorker.ready;
      })
      .then((ready) => {
        // Files loaded before the worker took over get cached too.
        const urls = [location.href, ...performance.getEntriesByType("resource").map((e) => e.name)];
        ready.active?.postMessage({ type: "CACHE_URLS", urls });
      })
      .catch(() => {
        // No service worker (a private window, an http address): Dawn still works online.
      });
    // Look for a new version now and then, and when the window comes back.
    const check = () => void reg?.update().catch(() => {});
    const timer = window.setInterval(check, 30 * 60 * 1000);
    window.addEventListener("focus", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  if (!waiting) return null;
  return (
    <div role="status" className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-surface-raised px-4 py-2.5 text-[12.5px] shadow-2xl">
      <span>A new version of Dawn is available.</span>
      <button
        type="button"
        onClick={() => {
          reloading.current = true;
          waiting.postMessage("SKIP_WAITING");
        }}
        title="Save first if you have unsaved changes outside the autosave"
        className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1 font-medium text-black hover:brightness-110"
      >
        <RefreshCw size={12} /> Reload
      </button>
      <button type="button" onClick={() => setWaiting(null)} aria-label="Later" className="text-muted hover:text-foreground">
        <X size={14} />
      </button>
    </div>
  );
}
