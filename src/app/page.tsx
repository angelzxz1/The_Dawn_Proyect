"use client";

import dynamic from "next/dynamic";

// The DAW is entirely Web Audio/client-side interactive (and assigns things
// like per-channel colors from module-level counters), so it's rendered
// client-only rather than prerendered - avoids hydration mismatches for
// state that isn't meant to be deterministic across a server/client boundary.
const Daw = dynamic(() => import("@/components/Daw").then((mod) => mod.Daw), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center text-sm text-muted">
      loading the studio…
    </div>
  ),
});

export default function Home() {
  return <Daw />;
}
