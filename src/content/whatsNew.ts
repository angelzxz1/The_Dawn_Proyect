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
    version: "0.3.0",
    date: "October 2026",
    title: "Edit, comp and warp",
    items: [
      "Edit tools for the arrangement - pointer, split, draw, erase and slip - with a quick switch, and time selection across tracks: cut, copy, paste, duplicate or delete a span, insert silence or take the time out.",
      "Name and color clips; consolidate, reverse and normalize them, and fade them with presets.",
      "Takes and comping: loop-record into take lanes and swipe across them to keep the best parts.",
      "Tempo changes on a tempo lane, with the grid, loop and metronome following them.",
      "Warp audio clips to the song's tempo (stretched or repitched), find a loop's tempo, and quantize the hits in audio to the grid.",
      "Zoom with Ctrl/Cmd + scroll or a pinch, zoom to fit, and drag tracks taller or shorter.",
      "Group tracks, send tracks into each other, fold them away and give them any color; Audio From records one track from another.",
      "The keys float in their own window and name the chord you play, in your scale's key (E Major until you pick one).",
      "The piano roll gets an overview to scroll and zoom, Follow, paste at a marker and velocity edits on many notes.",
      "Furnace, a modeled high-gain tube amp; stereo takes; a louder metronome with its own level; meters for both channels.",
      "Install Dawn as an app that works offline, share sounds as .dawnpack packs, and find your way with a first-run tour and demo song. Feedback now goes to Discord.",
    ],
  },
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
