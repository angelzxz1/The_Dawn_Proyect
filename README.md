![The Dawn Project](public/banner.png)

**The Dawn Project** is a digital audio workstation (DAW) that runs entirely
in the browser. You can record and edit MIDI and audio, arrange clips on a
timeline, play three built-in instruments, and mix with 18 studio effects.
Projects are saved to a folder on your computer. Nothing has to be installed
and no account is needed: the sound is made on your machine with the Web
Audio API.

It's built with [Next.js](https://nextjs.org) and
[Tone.js](https://tonejs.github.io/), and its workflow borrows from Ableton
Live and Reaper.

## Contents

- [What it can do](#what-it-can-do)
- [Instruments](#instruments)
- [Effects (plugins)](#effects-plugins)
- [Getting started](#getting-started)
- [User guide](#user-guide)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [How it works](#how-it-works)
- [Development](#development)

## What it can do

- **MIDI and audio tracks.** Add as many tracks as you like. Each holds any
  number of clips that you move, trim, loop, split and duplicate on the
  timeline.
- **Recording.** Record MIDI from the computer keyboard, the on-screen piano
  or drum pads, or a MIDI controller. Record audio from a microphone or an
  audio interface, with a count-in, a metronome and a loop region. Each clip
  is drawn on its track while you record it.
- **Piano roll** to draw, select, move, quantize and adjust the velocity of
  notes.
- **Three instruments:** a sampled grand piano, a drum kit, and Daybreak, a
  wavetable synth with a modulation matrix.
- **18 effects**, most with their own full-size window, graphs and meters,
  plus presets.
- **Sidechain.** Compressors, gates and multiband dynamics can listen to
  another track (for example, the kick ducking the bass).
- **Send/return buses** and a **master bus**, each with their own effects.
- **Automation** of volume, pan and any effect knob.
- **Delay compensation.** Effects that add latency (lookahead, oversampling,
  amp models) are compensated so every track stays in time, both when you
  play and when you export.
- **Undo/redo** for every edit, kept with the project.
- **Projects on your computer.** New, Open, Save and Save As, with recent
  projects. A project is a folder holding the song, its audio files and its
  undo history, or a single `.dawnproject` file.
- **Export** the mix to a WAV file, and clips or tracks to `.mid` files.
- **Import** audio files (by drag and drop or the file picker) and `.mid`
  files.

## Instruments

A MIDI track plays one instrument, which you choose in its FX rack.

| Instrument | What it is |
| --- | --- |
| **Piano** | A sampled acoustic grand, the Salamander Grand Piano (a Yamaha C5). |
| **Drums** | A 10-piece kit: kick, snare, clap, three toms, closed and open hi-hat, crash and ride. |
| **Synth (Daybreak)** | A wavetable synth in the spirit of Ableton's Wavetable and Vital. It has two wavetable oscillators (17 factory tables, or import your own) with warps and up to 16-voice unison, a sub and a noise source, and two filters (11 types). Three envelopes, three LFOs and four macros drive a drag-and-drop modulation matrix. It comes with 28 factory presets, and you can save your own. See [The synth](#the-synth-daybreak). |

All three respond to velocity, the sustain pedal, pitch bend and the mod
wheel.

## Effects (plugins)

Effects are grouped in the browser on the left of the screen, the way
Ableton's device browser does it. Every effect can be bypassed, reordered,
automated and saved as a preset, and most come with factory presets.

### Dynamics

| Effect | What it does |
| --- | --- |
| **Compressor** | A standard compressor with threshold, ratio, attack, release, knee, auto or manual makeup gain, dry/wet and output. It shows a transfer curve and a gain-reduction meter. **Sidechain.** |
| **Glue Compressor** | A bus compressor modeled on a classic analog console design. It has stepped ratios (2, 4, 10), stepped attack and release with an **Auto** release, a Range control, soft clip, optional 2x oversampling, and an analog-style needle meter with a clip LED. **Sidechain** with its own dry/wet. |
| **Multiband Compressor** | Up to 6 bands with Linkwitz-Riley crossovers. Each band can compress, expand or compress upward, and has its own threshold, ratio, attack, release, range and makeup gain. **Sidechain.** |
| **Multiband Dynamics** | Modeled on Ableton's Multiband Dynamics. It has up to 3 bands, each with an *above* and a *below* threshold, so one band can compress, expand, limit, gate and compress or expand upward at once. You edit it by dragging on its display. It also has RMS or peak detection, soft knee, and global Time and Amount controls. **Sidechain.** |
| **Limiter** | A lookahead brickwall limiter with gain, ceiling, release and soft clip. |
| **Noise Gate** | A gate with threshold, attack, hold, release and range. Its display scrolls the last few seconds of input and shows when the gate is open. **Sidechain.** |

### EQ and filter

| Effect | What it does |
| --- | --- |
| **Parametric EQ** | A Pro-Q-style EQ with up to 24 bands. Band shapes are bell, low and high shelf, low and high cut (with a choice of slope), notch, band pass and tilt shelf. Each band can run in stereo, left, right, mid or side, and can be soloed. It has a live spectrum analyzer. |
| **EQ Three** | A DJ-style 3-band EQ with adjustable crossovers. |
| **Filter** | Lowpass, highpass, bandpass, notch, peak and shelf filters with a 12, 24 or 48 dB/oct slope, resonance, and an LFO that sweeps the cutoff. |

### Modulation, distortion, reverb and delay

| Effect | What it does |
| --- | --- |
| **Chorus** | Rate, delay, depth, feedback and stereo spread, with a sine or triangle LFO. |
| **Pitch Shift** | Transposes by semitones and cents, with window and feedback controls. |
| **Saturator** | Drive through six curves: analog clip, soft sine, medium, hard, digital clip and fold. It also has bias, tone, a pre/post "color" EQ, soft clip and up to 4x oversampling. |
| **Reverb** | Hall, Room and Plate modes, with pre-delay, decay, damping, early reflections, low and high cut, and stereo width. |
| **Delay** | A stereo delay with left and right times, which can be synced to the tempo or linked. It has feedback, a filter on the repeats, ping-pong and freeze. |

### Amp, cabinet and utilities

| Effect | What it does |
| --- | --- |
| **NAM Amp** | Loads [Neural Amp Modeler](https://www.neuralampmodeler.com/) `.nam` amp captures, with input, a bass/middle/treble tone stack, output and normalize. |
| **IR Loader** | Loads an impulse response (a speaker cabinet, a room) from an audio file, with low and high cut, dry/wet and normalize. It draws the IR's frequency response. |
| **Utility** | Gain, stereo width, balance, mono, bass mono, per-channel phase invert, channel select (stereo, left, right or swapped), a DC filter and mute. |
| **Tuner** | A chromatic tuner with an adjustable reference pitch (A4 = 410 to 480 Hz), sharps or flats, and an option to mute the track while tuning. |

## Getting started

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). For a production
build, run `npm run build` and then `npm start`.

### Browser support

The app works best in **Chrome** or **Edge** on a desktop computer.

- **Saving projects to folders** uses the File System Access API, which only
  Chromium browsers have. Other browsers save and open a single
  `.dawnproject` file instead.
  - **Brave** has the API turned off by default. Turn it on at
    `brave://flags/#file-system-access-api`.
- **MIDI controllers** need the Web MIDI API: Chrome, Edge or Opera, or
  Firefox with its permission prompt.
- **Recording audio** needs permission to use the microphone. Use headphones
  while you monitor or record, so the speakers don't feed back into the
  microphone.

## User guide

### The screen

- **Header.** The **File** menu, the project's name (a dot means unsaved
  changes), the audio engine's load and latency, and **Export WAV**.
- **Transport.** Record, play/pause, stop, metronome, loop, tempo, time
  signature and count-in.
- **Effect browser** (left). Every effect and preset, with a search box.
- **Arrangement.** The ruler, then one row per track: its header on the left
  (name, color, arm, monitor, mute, solo, FX, input, import and export) and
  its clips on the right.
- **Buses and master.** The send/return buses and the master bus with its
  volume, pan and limiter ceiling.
- **Instrument panel.** The on-screen piano or drum pads for the selected
  track, with pitch bend, the mod wheel and sustain. You can collapse it.
- **FX rack** (bottom). The selected track's (or bus's) instrument and effect
  chain, left to right. You can collapse it.

### Projects

Everything is in the **File** menu:

- **New Project** starts an empty song.
- **Open Project…** (Ctrl+O) opens a project folder.
- **Recent** reopens a project you've used before.
- **Save** (Ctrl+S) saves into the project's folder. The first time, it asks
  for a name and then where to create the folder.
- **Save As…** (Ctrl+Shift+S) saves a copy under a new name.
- **Export / Import Project File…** packs the whole project into one
  `.dawnproject` file, for backups or for moving it to another computer.

A project folder looks like this:

```
My Song/
  project.dawn.json   the song: tracks, clips, notes, effects, automation
  Samples/            recordings, imported audio, impulse responses and amp models
  history.json        the last 50 undo/redo steps
```

When you reopen a project, its undo history comes back too. New and Open ask
before discarding unsaved changes.

The browser also keeps a working copy of the current song ("autosaved" in
the header). A reload or a crash doesn't lose anything, even if you
haven't saved to a folder yet.

### Tracks

- **Add a track** with **+ MIDI** or **+ Audio** under the track list.
  - A **MIDI** track plays an instrument and holds note clips.
  - An **audio** track holds audio clips and records from an input.
  - A track's type can't be changed later. Both kinds can use every effect.
- **Rename** a track by double-clicking its name. Click the color swatch to
  recolor it, and use the arrows to move it up or down.
- **Mute** and **Solo** work as in any mixer. Each track also has **volume**,
  **pan** and a level meter.
- **Choose the instrument** for a MIDI track in its FX rack: None, Piano,
  Drums or Synth. The synth's window opens from there too (see
  [The synth](#the-synth-daybreak)).
- **Choose the input** of an audio track (which microphone or
  audio-interface channel it records from) in its header.

### Playing

- **Computer keyboard**, laid out like Ableton's: the `Z` row plays the lower
  octave (`Z S X D C V G B H N J M`, black keys on the row above), and the
  `Q` row plays the next one (`Q 2 W 3 E R 5 T 6 Y 7 U I`). The octave
  buttons next to the on-screen piano shift the range by up to 2 octaves.
- **Drum pads** play from `A S D F G H J K L ;`.
- **MIDI controllers** are picked up automatically. Notes, velocity, the
  sustain pedal, pitch bend and the mod wheel all work.
- **Scale.** The scale selector (Major, Minor, the modes, pentatonics and so
  on, with any root) highlights the notes in the key on the piano and in the
  piano roll.
- Keys play the **armed** track (the red button in its header). Only one
  track is armed at a time.

### The synth (Daybreak)

Choose **Synth** as a MIDI track's instrument, then open it from its card in
the FX rack. The card also shows the preset and the four macro knobs.

- **Presets.** The bar at the top browses the factory sounds by category
  (Bass, Lead, Pad, Pluck, Keys, FX), with a search box. Use the arrows to step
  through them. The save button keeps your own sound in this browser.
- **Oscillators.** Each plays a wavetable, a stack of single-cycle waves.
  - **Position** scans through the stack; the 3D view lights up the wave being
    played, as it moves.
  - **Warp** bends how the wave is read: Sync, Bend, Squeeze, Pulse, Mirror,
    Fold, Quantize, and FM or Ring from the other oscillator.
  - **Unison** stacks up to 16 detuned copies, with **Detune**, **Blend** and
    stereo **Width**.
  - The arrows next to the table name step through the tables. The upload
    button imports an audio file as a wavetable (cut into 2048-sample cycles,
    like Ableton's Wavetable); it's saved with the project.
  - **F1 / F2 / F1+2 / Out** chooses which filter the oscillator goes through.
- **Sub and Noise.** The sub is a sine, triangle, saw or square one or two
  octaves down. The noise source is white or pink.
- **Filters.** Low and high pass (12 or 24 dB), Ladder, Band, Notch, Morph
  (low → band → high → notch), Comb + and −, and Vowel. Filter 2 runs after
  filter 1 (**1 → 2**) or beside it (**1 | 2**).
- **Voice.** **Poly** plays chords (up to 16 voices); **Mono** plays one note
  at a time; **Legato** also doesn't restart the envelopes when notes overlap.
  **Glide** slides between notes, and **Bend** sets the pitch-bend range.
- **Envelopes.** Env 1 shapes each note's volume; Env 2 and Env 3 are free
  to modulate anything. Drag the points on the graph to set the times and
  sustain; drag the small points on each slope to bend it.
- **LFOs.** Seven shapes, free in Hz or synced to the tempo. Each can
  **Retrigger** with each note, run **Free**, or play once (**One Shot**),
  with a start phase and a fade-in.

**Modulation**

- **Add one.** Every source has a **+** handle: on the envelope and LFO tabs,
  the Sources list (velocity, note, mod wheel, pitch bend, random) and under
  each macro. Drag it onto a knob.
- **Set the amount.** The knob gets a colored ring for each modulation. Drag
  the dot at the end of the ring to set how much it moves the knob.
- **Edit or remove.** Right-click a knob to see its modulations, change their
  amount or direction (±), or remove them.
- **See where it goes.** Click a source's handle to highlight what it
  modulates.
- **While you play,** a white dot on each modulated knob shows where it
  really is.
- **The Matrix tab** lists every modulation (up to 32) to edit in one place.

### Recording

1. **Arm** the track you want to record into.
2. Optionally, set a **count-in** (bars of clicks before recording starts),
   turn on the **metronome**, and set a **loop** region.
3. Press **Record**. The take appears on its track as a red clip that grows
   while you play.
4. Press **Stop**. The take becomes a normal clip.

For audio:

- **Monitor** (the headphones button) lets you hear the input live through
  the track's effects, for example through an amp model.
- Recordings are lined up with the beat automatically, using the latency the
  browser reports. If they still land early or late on your hardware, set a
  **recording offset** in the audio settings, next to the engine-load
  display in the header.

### Editing clips

- **Select.** Click a clip to select it. Ctrl/Cmd-click selects more.
- **Move.** Drag the clip. Moves snap to the grid chosen in **Snap** (off,
  bar, 1/2, 1/4, 1/8 or 1/16).
- **Resize.** Drag a clip's right edge.
- **Audio clips** also have handles for **fade-in**, **fade-out** and
  **gain**. Double-click the gain handle to reset it.
- **Right-click** a clip for **Split at playhead**, **Duplicate**, **Loop
  clip**, **Copy**, **Paste** and **Delete**, plus **Edit in piano roll** and
  **Export .mid** for MIDI clips.
- **Right-click an empty part of a lane** to add an empty MIDI clip, import
  an audio clip there, or paste.
- **Import audio** by dropping a file onto a track, or with the import button
  in the track's header. The same buttons import and export `.mid` files.
- **Move the playhead** by clicking or dragging on the ruler. Play always
  starts from there.
- **Set a loop region** by Shift-dragging on the ruler.

### The piano roll

Double-click a MIDI clip to open it.

- **Draw mode** (pencil): click and drag on the grid to draw a note.
- **Select mode** (arrow): drag a box around notes to select them, then drag
  them to move them.
- Press **B** to switch between the two modes.
- **Arrow keys** nudge the selected notes by a semitone or a 1/16 note.
- **Q** quantizes the notes to the chosen resolution (1/4 to 1/32).
- **Delete** removes the selected notes, and **Ctrl+C / Ctrl+V** copy and
  paste them.
- The **velocity lane** at the bottom sets how hard each note is played: drag
  a note's bar up or down.
- **Zoom** with the + and − buttons, and press **Space** to play or stop.

### Effects

- **Add an effect** by dragging it from the browser onto the FX rack at the
  place you want it, or click it to add it at the end of the selected track's
  chain.
- **Drag a card's handle** to reorder effects, **power** button to bypass,
  **×** to remove.
- **Open the full window** from a card's expand button. It has the complete
  controls, graphs and meters.
- **Knobs:** drag to turn, **double-click** to reset, and **click or
  right-click** to type an exact value.
- **Presets:** each card and window has a preset bar. Use the arrows to step
  through presets, the name to open the list, and the save button to save
  your own. Your presets can be renamed and deleted. Presets also appear
  under each effect in the browser, where you can drag them onto the rack.
  Your own presets are kept in this browser; factory presets are built in.
- **Effects with files:** the **IR Loader** takes an audio file (a cabinet or
  room impulse response) and the **NAM Amp** takes a `.nam` model. The file
  is saved inside the project's `Samples` folder.

### Sidechain

The Compressor, Glue Compressor, Noise Gate, Multiband Compressor and
Multiband Dynamics can be driven by another track instead of their own.

1. Open the effect's window and turn on **Sidechain**.
2. Pick the source track or bus, and where to take its signal from:
   **Pre FX**, **Post FX** or **Post Fader**.
3. Shape the key signal with **Gain** and its low and high cut filters.
   **Listen** (the headphones button) lets you hear what the detector hears.

The rack card shows an **SC** badge while a sidechain is on. A muted source
still drives the sidechain, and routings that would create a loop aren't
offered.

### Buses and sends

- **+ Bus** in the **Send/return buses** strip adds a return bus. Each bus
  has its own name, effects (from **FX**), volume and pan.
- Every track's FX rack ends with a **Sends** card, with one level per bus.
  For example, put a Reverb on a bus and send several tracks to it.
- The **master bus** has its own FX chain, and the master strip has volume,
  pan and a **Ceiling** limiter that keeps the mix from clipping.

### Automation

- Open a track's **automation lane** from its header, and choose what to
  automate: volume, pan, or any knob of any effect on that track.
- **Click** the lane to add a point, **drag** a point to move it, and
  **right-click** a point to delete it.

### Exporting

- **Export WAV** (in the header) renders the whole project to a WAV file,
  with every effect, send, sidechain, automation and the master bus, and with
  delay compensation applied.
- **Export .mid** saves a single clip (from its right-click menu) or a whole
  track (from its header) as a standard MIDI file.

### Audio settings and latency

Click the engine-load display in the header to see:

- the audio engine's CPU load, and its peak over the last few seconds;
- the sample rate;
- the output and input latency;
- how much effect delay is being compensated.

From there you can:

- turn **delay compensation** on or off;
- turn on **reduced latency when monitoring**, so the monitored or armed
  track skips the wait added for other tracks' effects;
- set the **recording offset**.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Space | Play / pause |
| Ctrl/Cmd+Z | Undo |
| Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y | Redo |
| Ctrl/Cmd+C | Copy the clip under the playhead on the selected track |
| Ctrl/Cmd+V | Paste the copied clip at the playhead |
| Ctrl/Cmd+D | Duplicate the selected clips |
| Delete / Backspace | Delete the selected clips |
| Ctrl/Cmd+S | Save |
| Ctrl/Cmd+Shift+S | Save As |
| Ctrl/Cmd+O | Open a project |
| `Z`…`M`, `Q`…`I` and the number row | Play notes |
| `A`…`;` | Play drum pads |
| **In the piano roll:** | |
| B | Switch between Draw and Select |
| Q | Quantize |
| Arrow keys | Nudge the selected notes |
| Delete / Backspace | Delete the selected notes |
| Ctrl/Cmd+C, Ctrl/Cmd+V | Copy / paste notes |
| Space | Play / stop |

## How it works

### Audio engine

- **Tone.js runs the core.** `src/lib/audioEngine.ts` owns the transport,
  each track's signal chain (instrument → effects → volume/pan → sends), the
  buses and the master.
- **Scheduling.** Clips are scheduled on the Tone transport. MIDI you play
  live goes straight to the instrument, not through the transport.
- **The custom effects and the synth run in AudioWorklets**, in the audio
  thread: the compressors, gate, limiter, parametric EQ, multiband effects,
  saturator, utility and Daybreak (`synthKernel.ts`). The DSP for each is plain JavaScript kept as a source string (for
  example `glueModel.ts`). The same text runs:
  - in the worklet, to make the sound;
  - in the plugin's window, to draw its curves;
  - in the unit tests, to check it.

  So what you see and what's tested is exactly what you hear.
- **The synth** gets its notes as timestamped events, so each starts on its
  exact sample. Its wavetables are built on the main thread
  (`wavetableModel.ts`) as band-limited copies with fewer and fewer
  harmonics; each note plays the richest one that won't alias. Modulation is
  worked out every 32 samples and smoothed in between.
- **NAM Amp** runs Neural Amp Modeler's C++ core compiled to WebAssembly
  (`public/nam`), in a worklet.
- **Latency compensation.** Each effect reports its latency: lookahead,
  oversampling filters, amp models. The engine delays the faster tracks so
  every track reaches the master at the same time. Sidechain keys are delayed
  the same way, so they line up with the signal they control (`latency.ts`,
  `sidechainRouting.ts`).
- **Export.** `bounce.ts` rebuilds the same graph in an `OfflineAudioContext`
  and renders it faster than real time, so the WAV matches what you hear.
- **Recording.** Audio is captured sample-accurately by a worklet
  (`inputRecorder.ts`) and aligned using the measured latencies. MIDI takes
  are stored as note events.

### Data and storage

- **The project is plain data** (`projectSchema.ts`): tracks, clips, notes,
  effects and their settings, automation, buses, tempo and so on. Anything
  loaded from disk is checked and repaired (`normalizeProject`), so an old or
  damaged file still opens.
- **Undo/redo** keeps snapshots of that data. The audio itself isn't copied:
  snapshots refer to the clips by id.
- **Autosave.** The working copy (the project, its audio and effect files) is
  autosaved to the browser's IndexedDB (`persistence.ts`).
- **Project folders** use the File System Access API (`projectFiles.ts`). A
  save writes only new sample files, removes ones nothing uses anymore, and
  writes `project.dawn.json` last. The single-file `.dawnproject` format is a
  small header followed by the same JSON and files.

## Development

```bash
npm run dev     # start the dev server
npm test        # unit tests (Vitest): DSP kernels, routing, latency, presets, project files
npm run lint    # ESLint
npm run build   # production build
```

- `src/app/`: the Next.js App Router entry (the whole app is one client page).
- `src/components/`:
  - `Daw.tsx`, which holds the app's state;
  - the arrangement, transport, piano roll and FX rack;
  - each plugin's rack card, window and graphs.
- `src/lib/`:
  - the audio engine and each effect's engine node;
  - DSP models (`*Model.ts`) with their tests;
  - the project schema, persistence, project files, MIDI and WAV I/O.

### Stack

- [Next.js](https://nextjs.org) 16 (App Router), React 19, TypeScript and
  Tailwind CSS 4.
- [Tone.js](https://tonejs.github.io/) for the Web Audio engine, transport
  and instruments.
- [@tonejs/midi](https://github.com/Tonejs/Midi) for reading and writing MIDI
  files.
- [Neural Amp Modeler](https://github.com/sdatkinson/NeuralAmpModelerCore)
  (WebAssembly) for the NAM Amp. Its licenses are in `public/nam`.
- [lucide-react](https://lucide.dev) for icons.
