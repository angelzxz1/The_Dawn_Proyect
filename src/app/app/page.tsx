"use client";

import dynamic from "next/dynamic";
import { DesktopOnly } from "@/studio/shell/DesktopOnly";

const loading = <div className="flex flex-1 items-center justify-center text-sm text-muted">loading the studio…</div>;

// The DAW is entirely Web Audio/client-side interactive (and assigns things
// like per-channel colors from module-level counters), so it's rendered
// client-only rather than prerendered - avoids hydration mismatches for
// state that isn't meant to be deterministic across a server/client boundary.
const Daw = dynamic(() => import("@/studio/Daw").then((mod) => mod.Daw), {
  ssr: false,
  loading: () => loading,
});

/** The studio. Phones and tablets get a note instead (see DesktopOnly). */
export default function Studio() {
  return (
    <DesktopOnly loading={loading}>
      <Daw />
    </DesktopOnly>
  );
}
