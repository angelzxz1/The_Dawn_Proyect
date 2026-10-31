// The metronome's click sounds to choose from: their names, in the order
// metronomeKernel.ts (and the native engine's port) keep them, and what
// the menu calls them.

export const CLICK_SOUNDS = ["classic", "beep", "wood", "cowbell"] as const;
export type ClickSound = (typeof CLICK_SOUNDS)[number];

export const CLICK_SOUND_LABELS: Record<ClickSound, string> = {
  classic: "Classic",
  beep: "Beep",
  wood: "Wood block",
  cowbell: "Cowbell",
};
