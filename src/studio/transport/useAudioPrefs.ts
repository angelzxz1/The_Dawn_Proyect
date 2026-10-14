"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_AUDIO_PREFS, getAudioPrefs, subscribeAudioPrefs, updateAudioPrefs, type AudioPrefs } from "@/engine/audioPrefs";

/** This computer's audio settings (audioPrefs.ts), and a way to change
 * them; every component using it sees the same, current values. */
export function useAudioPrefs(): [AudioPrefs, (change: Partial<AudioPrefs>) => void] {
  const prefs = useSyncExternalStore(subscribeAudioPrefs, getAudioPrefs, () => DEFAULT_AUDIO_PREFS);
  return [prefs, updateAudioPrefs];
}
