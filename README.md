# The Dawn Project

A browser-based digital audio workstation (DAW), built with Next.js and
[Tone.js](https://tonejs.github.io/).

This first milestone focuses on MIDI: playing, recording, and exporting/importing
standard `.mid` files with a realistic sampled grand piano.

## Features

- **Piano instrument** — a sampled grand piano (Salamander Grand Piano,
  the same sample set used in Tone.js's own examples), playable with the
  mouse/touch, your computer keyboard (Ableton-style Z/Q row mapping), or
  a connected MIDI controller via the Web MIDI API.
- **Multi-channel recording** — each channel arms independently, records
  your performance as MIDI (not audio), and shows it as a small piano-roll.
- **MIDI import/export** — load a `.mid` file into any channel, or export a
  channel's recorded clip as a standard MIDI file.
- **Channel strip** — every channel has a pan knob, a volume knob, and a
  live level meter with peak hold.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Click a channel to
arm it, then hit record and play the on-screen piano (or your MIDI
keyboard) to capture a take.

## Stack

- [Next.js](https://nextjs.org) (App Router, TypeScript, Tailwind CSS)
- [Tone.js](https://tonejs.github.io/) for the Web Audio engine, transport,
  and sampler
- [@tonejs/midi](https://github.com/Tonejs/Midi) for reading/writing
  standard MIDI files
