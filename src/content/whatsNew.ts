// Release notes for the "What's new" panel, newest first. Add an entry (and
// bump package.json's version) with each release: people who used an
// older version see it once.

export interface Release {
  version: string;
  date: string;
  title: string;
  items: string[];
}

export const RELEASES: Release[] = [
  {
    version: "0.2.0",
    date: "October 2026",
    title: "From idea to demo, faster",
    items: [
      "Start from a template: Guitar Demo, Beat, Voice + Guitar or an empty project.",
      "Grooves: 60 drum patterns in 12 genres to drag onto a track, plus Rock Kit and Brushes kits.",
      "Export the mix or stems as MP3 or WAV, the whole song or just the loop.",
      "Guitar tones out of the box: six built-in cabinets and ready-made chains (clean, crunch, high gain, bass, acoustic, vocal).",
      "An input meter with a clip light on armed audio tracks, and cleaner live monitoring.",
      "About, credits and privacy pages, and a way to send feedback.",
    ],
  },
];

export const LATEST_VERSION = RELEASES[0].version;
