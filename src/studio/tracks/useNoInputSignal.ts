"use client";

import { useEffect, useState } from "react";
import { audioEngine } from "@/engine/audioEngine";

/** Below this (dBFS) the input counts as silent. */
const SILENT_DB = -70;
/** How long it has to stay silent before it's said (ms). */
const AFTER_MS = 3000;
const POLL_MS = 250;

/** While `watching` (a track monitoring the audio interface), whether the
 * input has been silent for a few seconds: no signal coming in (the wrong
 * input picked, a cable out, a muted interface). */
export function useNoInputSignal(watching: boolean): boolean {
  const [silent, setSilent] = useState(false);
  useEffect(() => {
    if (!watching) return;
    let quietSince = performance.now();
    const floor = Math.pow(10, SILENT_DB / 20);
    const timer = setInterval(() => {
      const peak = audioEngine.getInputPeak();
      const now = performance.now();
      if (peak !== null && peak > floor) quietSince = now;
      setSilent(now - quietSince >= AFTER_MS);
    }, POLL_MS);
    return () => {
      clearInterval(timer);
      setSilent(false);
    };
  }, [watching]);
  return watching && silent;
}
