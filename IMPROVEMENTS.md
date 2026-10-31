# Improvements

Checked against the code and the commit history on 2026-10-29; item 7 of Part 2 was added on 2026-10-30, items 8, 9, 16, 21 and 22 on 2026-10-31.

- `[x]` is done; the commit that did it is in brackets.
- `[ ]` is still open; "Partly" says what already exists.

**Summary:** Part 1 is all done. In Part 2, items 1–9, 16, 21 and 22 are done and the rest of 10–28 are open; three of the open items (12, 20, 25) are partly there.

## Part 1: Code improvements

### Structure

- [x] **1. Split up `Daw.tsx`.** One component held 64 pieces of state, 135 handler functions and 31 effects, and every change redrew the whole studio. That was part of why notes came out late at record start. The plan was to move it into feature modules (tracks, clips, transport, mixer, project) behind a shared store, to make it easier to read and much faster to redraw.
  - Done: the project document is now in a shared store (`src/state/projectStore.ts`), with actions in `src/state/`, and the context menus, project files and automation are in their own files (`51afb1a`, `4addae6`, `4685bba`, `0d4c979`, `4743a8e`).
  - Still large: `Daw.tsx` has 2,838 lines, 47 `useState` calls and 34 `useEffect` calls. It could be split further.
- [x] **2. Split up `audioEngine.ts`.** Channels, routing, monitoring, recording, metronome, latency compensation and automation all lived in one class, and separate modules would be easier to test. (`f88f484`: routing, latency, metronome, inputs and the rest are now modules in `src/engine/`)
- [x] **3. Build the live sound and the export from one shared routing description.** `audioEngine.ts` and `bounce.ts` each wired tracks, groups, routing, sidechains, monitoring and delay compensation separately. Every routing feature had to be built twice, which is how the export could drift from what you hear. (`39d80f7`: `mixGraph.ts`)
- [x] **4. Make undo cheaper.** Each undo or redo tore down every track in the engine and rebuilt it, NAM and IR included, which could cause dropouts and pauses with heavy effects. (`4760168`: only what differs is rebuilt)
- [x] **5. One central keyboard-shortcut handler.** There were 23 separate keyboard listeners, each with its own "am I typing in a text field?" check. That caused conflicts (Escape, Space, Ctrl+G) and made a shortcut editor impossible. (`419e30a`: `shortcuts.ts`)

### Audio and timing

- [x] **6. Fix the timing workaround properly.** The 10 ms scheduling window and the 0.12 s delay before Play were workarounds. The fix was to trigger live notes immediately and give everything the timeline schedules a longer safety margin. (`cb241ba`)
- [x] **7. Stop swallowing errors silently.** There were 51 empty error handlers, and the engine dropped notes without a trace when something failed. (`bef2998`: `noteIssue` in `src/services/issues`)
- [x] **8. Record in stereo.** Takes were mono, which mattered most for recording from another track. (`f27a175`: recording from another track is stereo; a mono input still records one channel)
- [x] **9. Save monitoring state** with the project, so a monitored "Audio from" chain comes back after a reload. (`d2424e1`)
- [x] **10. Reduce forced type conversions.** There were 19 of them around Tone.js and the browser's audio objects. (`e342052`: kept in one place)

### React and code quality

- [x] **11. Fix the remaining lint errors.** 10 known errors remained, including undo/redo button states that React didn't track and `TransportBar` copying values into its own state. (`8458fc2`)
- [x] **12. Review the disabled dependency checks.** There were 19 places where the "missing dependency" lint rule was turned off, each a possible stale-value bug. (`27b1e57`)
- [x] **13. Memoize track headers and lanes,** so a playback or state change doesn't redraw every track. (`2151899`)
- [x] **14. Move the metronome's scheduling timer off the main thread,** so long page stalls can't starve it. (`32bb621`, `8e95c63`: the clicks are made on the audio thread)

### Testing and tooling

- [x] **15. Turn the browser test scripts into a real test suite.** (`58c69bb`: Playwright, in `e2e/`)
- [x] **16. Add component tests** for the piano roll, track header and FX rack. (`6a5d7c7`)
- [x] **17. Add automatic checks** on every push: type check, lint, unit tests, browser tests and build. (`566e24e`: `.github/workflows/ci.yml`)
- [x] **18. Add a `typecheck` script** to `package.json`, and stop accepting the "10 known lint errors" exception. (`6b8518a`, `8458fc2`)
- [x] **19. Make the build work offline.** It downloaded Google Fonts at build time. (`453b47f`: the fonts are in `src/fonts/`)

## Part 2: Dawn compared with other DAWs (UI and experience)

**Where Dawn already stands well:**

- Ableton-style editing in several places: paste at the marker, record from the marker, the loop brace, folding.
- Strong built-in effects: NAM amp models, IRs, a parametric EQ and multiband dynamics.
- Plugin delay compensation and accurate recording alignment.
- Group tracks, plus Audio to / Audio from routing.
- A guided tour and a demo song.

That is already ahead of most browser DAWs, such as BandLab or Soundtrap.

**Where it's behind Ableton, Logic, Reaper and FL Studio:**

### Arrangement and editing

- [x] **1. Edit tools beyond select:** split by clicking, draw, erase and slip-edit tools, plus a quick tool switch. (`877b8d9`)
- [x] **2. Selecting a time range across several tracks** and acting on it (cut, duplicate, delete, insert silence). (`f392027`)
- [x] **3. Clip names and colors,** plus clip-level actions (consolidate, reverse, normalize, fade presets). (`8de9291`)
- [x] **4. Comping:** loop-record several takes and pick the best parts. (`a247a97`)
- [x] **5. Timing and tempo:** warp/time-stretch audio, a tempo map with tempo changes, and quantizing audio. (`527f033`, `72b0bdb`, `7acccc6`)
- [x] **6. Zoom like other DAWs:** Ctrl+wheel and pinch to zoom, zoom-to-fit and zoom-to-selection, and resizable track heights. (`47c7c5b`)
- [x] **7. Markers and song sections** (Intro, Verse, Chorus) that you can jump to and loop, like Logic's arrangement markers. (`23dbe29`)
  - A Sections lane under the tempo lane. Double-click it to add a marker on the nearest bar, named after a common song form (Intro, Verse, Chorus…). Click a marker to jump there, drag it to move it, double-click it to rename it. Right-click it to loop its section (to the next marker, or the song's end), pick a name or remove it.
  - Shift+M adds a marker on the bar nearest the playhead; Shift+←/→ jump to the previous or next one.
  - Kept in beats (`src/project/markers.ts`), saved with the project, and undoable. Time edits (insert silence, delete time) don't move them, as they don't move the tempo changes or the loop.
- [x] **8. Snap that adapts to zoom,** plus snapping to other clips' edges. (commit to come)
  - The Snap menu has **Adaptive**: the grid clips snap to follows the zoom, the finest line drawn (`snapUnitFor`), as the ruler, the loop and the markers already did. The fixed sizes stay; new projects still start on 1 Bar.
  - With the grid on, a moved clip's start or end, or a resized clip's end, snaps to another clip's edge on any track once it comes within 8 px, before the grid (`src/studio/timeline/clipSnap.ts`). Clips moving with the selection aren't snapped to. Alt drags free of both, as on the loop, marker and tempo lanes.
- [x] **9. Velocity and automation drawing tools:** curves, ramps and line tools, as in FL and Ableton. (commit to come)
  - Automation: a segment can bend (a point's `curve`, -1..1, `curveShape` in `src/engine/automation.ts`, which the engine, the export and the lane all use). With the pointer tool, Alt-drag a segment to bend it and Shift-drag to draw a straight line (a ramp) over what's there, on the grid (Alt: off it). The draw tool draws freehand, a point per grid line crossed; the erase tool deletes the points it passes over (`src/project/curveEdits.ts`).
  - Velocity: drag on empty space in the piano roll's velocity lane to put the notes it spans on a line (only the selected ones, with a selection); Alt draws freehand.
  - Fixed on the way: a point added before the last one was kept out of time order, which playback assumes, so it played wrong until a reload.

### Mixing

- [ ] **10. A real mixer view:** vertical channel strips with faders, meters, sends, inserts and Audio to/from, side by side. Today mixing happens in track headers and the FX rack.
- [ ] **11. Meters with peak hold and dB scales,** a master loudness meter (LUFS), and a clip warning on every track.
- [ ] **12. Faster effect handling:** drag effects between tracks, copy an effect chain to another track, and save a whole chain as a preset (Ableton Racks / FX Chains).
  - Partly: effects and presets can be dragged from the browser onto the rack, and there are factory effect chains (`src/effects/chains.ts`). You can't move or copy effects between tracks, or save your own chains.
- [ ] **13. Pre/post choice for sends,** and better visual routing feedback, for example highlighting where a track goes when you hover over it. ("Audio from" already has pre/post FX; sends don't.)

### Recording

- [ ] **14. Monitoring modes per track:** In / Auto / Off, as in Ableton, instead of one toggle.
- [ ] **15. Punch-in/out recording** within the loop region.
- [x] **16. A visible count-in** in the transport, and a click-volume control with click sound choices. (commit to come)
  - The transport shows the count-in as it goes, the beats left (4, 3, 2, 1), the bar's first beat brighter (`CountIn.tsx`, `Transport.countInLeft`).
  - Four click sounds, next to the click level: Classic (the one there was), Beep, Wood block and Cowbell (`metronomeKernel.ts` `makeClick`, and the native engine's port in `metronome.rs`). Like the level, it's a setting of this computer (`audioPrefs.ts`).
- [ ] **17. Choosing input channels on multi-input interfaces,** for example a mono guitar on input 2.

### Finding things and learning the app

- [ ] **18. A command palette or menu search** ("what do I want to do?") and a shortcut cheat sheet (press `?`).
- [ ] **19. More right-click menus,** covering everything you can do on a track, clip or effect, plus tooltips with the shortcut on every button.
- [ ] **20. A browser with previews:** hear grooves, samples, presets and amp models before dropping them in, with favorites and recent items.
  - Partly: grooves can be previewed. Samples, presets and amp models can't, and there are no favorites or recent items.
- [x] **21. More templates:** guitar recording, podcast and beat-making setups with the routing already wired. (commit to come)
  - Guitar Demo, Beat and Voice + Guitar were there; Podcast is new: Host (armed) and Guest mic tracks with the vocal chain, in a Voices group that glues and de-esses them, and a Music track whose compressor ducks it under the Voices group (a sidechain). No metronome or count-in, snap off, and Intro, Interview and Outro sections.
- [x] **22. Clear warnings for silent states:** "track muted by solo", "monitoring is on but no input", "this effect is bypassed". (commit to come)
  - A track that can't be heard for a reason other than its own Mute says why beside its name (`src/project/silentStates.ts`): another track is soloed, it plays into a muted group or track, its fader is all the way down, or it's a MIDI track with no instrument. The chip's tooltip tells the whole story.
  - A track monitoring the audio interface says "No input" once nothing has come in for 3 seconds (`useNoInputSignal.ts`), and stops when a signal arrives.
  - A bypassed effect's card is labelled "Bypassed" (not just dimmed), and the track's FX button counts the bypassed effects in its tooltip, with a dot.

### Visual and comfort

- [ ] **23. One consistent style for windows.** Effect windows, the Keys window and the Drum Rack each look and behave differently.
- [ ] **24. Light theme and adjustable UI size,** for laptop screens and 1440p/4K monitors.
- [ ] **25. Remember the layout:** panel sizes, folded tracks, the open FX rack and zoom, per project.
  - Partly: folded tracks and track heights are saved with the project. Panel sizes, the open FX rack and the zoom aren't.
- [ ] **26. Detach or second-screen windows** for the mixer and piano roll (Ableton 12, Logic).

### Accessibility and settings

- [ ] **27. Keyboard navigation of the timeline, screen-reader labels, and focus handling in dialogs.**
- [ ] **28. A real Preferences window** (audio device, buffer size, default count-in, autosave, theme) instead of settings scattered across popovers.
