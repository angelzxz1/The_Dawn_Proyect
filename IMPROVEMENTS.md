## Part 1: Code improvements

### Structure

1. **Split up `Daw.tsx`.** One component holds 64 pieces of state, 135 handler functions and 31 effects, and every change redraws the whole studio. That's part of why notes came out late at record start. Moving it into feature modules (tracks, clips, transport, mixer, project) behind a shared store would make it easier to read and much faster to redraw.
2. **Split up `audioEngine.ts`.** Channels, routing, monitoring, recording, metronome, latency compensation and automation all live in one class. Separate modules would be easier to test.
3. **Build the live sound and the export from one shared routing description.** Today `audioEngine.ts` and `bounce.ts` each wire tracks, groups, routing, sidechains, monitoring and delay compensation separately. Every routing feature so far has had to be built twice, which is how the export could drift from what you hear.
4. **Make undo cheaper.** Each undo or redo tears down every track in the engine and rebuilds it, NAM and IR included. With heavy effects that can cause dropouts and pauses. Comparing the before and after states and only rebuilding what changed would avoid that.
5. **One central keyboard-shortcut handler.** There are 23 separate keyboard listeners, each with its own "am I typing in a text field?" check. That causes conflicts (Escape, Space, Ctrl+G) and makes a shortcut editor impossible.

### Audio and timing

6. **Fix the timing workaround properly.** The 10 ms scheduling window, plus the 0.12 s delay I added before Play starts, are workarounds. The proper fix is to trigger live notes immediately and give everything scheduled by the timeline a longer safety margin. That would remove the start delay and protect all notes, not just the metronome and first beat, from page hiccups.
7. **Stop swallowing errors silently.** There are 51 empty error handlers, and the engine drops notes without a trace when something fails. At least log them in development and count them in error reporting.
8. **Record in stereo.** Takes are mono today, which matters most for recording from another track.
9. **Save monitoring state** with the project, so a monitored "Audio from" chain comes back after a reload.
10. **Reduce forced type conversions.** There are 19 of them around Tone.js and the browser's audio objects; a small adapter layer would keep them in one place.

### React and code quality

11. **Fix the remaining lint errors.** 10 known errors remain. Undo/redo button states are read in a way React doesn't track, so they can show the wrong state. `TransportBar` copies values into its own state in a way that causes extra redraws.
12. **Review the disabled dependency checks.** There are 19 places where the "missing dependency" lint rule is turned off, 6 of them in `Daw.tsx`. Each is a possible stale-value bug.
13. **Memoize track headers and lanes.** None are memoized, so every playback or state change redraws every track; this matters with 20+ tracks.
14. **Move the metronome's scheduling timer off the main thread** (or onto the audio clock) so even long page stalls can't starve it.

### Testing and tooling

15. **Turn my browser test scripts into a real test suite.** Recording alignment, metronome timing, routing, export and loading old projects are currently checked only by one-off scripts in a scratch folder.
16. **Add component tests** for the piano roll, track header and FX rack.
17. **Add automatic checks on GitHub** (no workflows exist today): type check, lint, unit tests, browser tests and build on every push.
18. **Add a `typecheck` script** to `package.json`, and stop accepting the "10 known lint errors" exception.
19. **Make the build work offline.** It downloads Google Fonts at build time, and failed once in this session because of the network; self-hosting the fonts fixes that.

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

1. **Edit tools beyond select:** split by clicking, draw, erase and slip-edit tools, plus a quick tool switch. Logic and FL make this very visible.
2. **Selecting a time range across several tracks** and acting on it (cut, duplicate, delete, insert silence). Ableton's main editing gesture is missing.
3. **Clip names and colors,** plus clip-level actions (consolidate, reverse, normalize, fade presets). Clips only show "12 notes" today.
4. **Comping:** loop-record several takes and pick the best parts, as in Logic and Ableton 11+. This is essential for recording guitar.
5. **Timing and tempo:** warp/time-stretch audio, a tempo map with tempo changes, and quantizing audio.
6. **Zoom like other DAWs:** Ctrl+wheel and pinch to zoom, zoom-to-fit and zoom-to-selection, and resizable track heights (drag the border) instead of only folded or full.
7. **Markers and song sections** (Intro, Verse, Chorus) that you can jump to and loop, like Logic's arrangement markers.
8. **Snap that adapts to zoom,** plus snapping to other clips' edges.
9. **Velocity and automation drawing tools:** curves, ramps and line tools, as in FL and Ableton.

### Mixing

10. **A real mixer view:** vertical channel strips with faders, meters, sends, inserts and Audio to/from, side by side. Every major DAW has one. Today mixing happens in track headers and the FX rack.
11. **Meters with peak hold and dB scales,** a master loudness meter (LUFS), and a clip warning on every track.
12. **Faster effect handling:** drag effects between tracks, copy an effect chain to another track, and save a whole chain as a preset (Ableton Racks / FX Chains).
13. **Pre/post choice for sends,** and better visual routing feedback, for example highlighting where a track goes when you hover over it.

### Recording

14. **Monitoring modes per track:** In / Auto / Off, as in Ableton, instead of one toggle.
15. **Punch-in/out recording** within the loop region.
16. **A visible count-in** in the transport, and a click-volume control with click sound choices.
17. **Choosing input channels on multi-input interfaces,** for example a mono guitar on input 2.

### Finding things and learning the app

18. **A command palette or menu search** ("what do I want to do?") and a shortcut cheat sheet (press `?`).
19. **More right-click menus,** covering everything you can do on a track, clip or effect, plus tooltips with the shortcut on every button.
20. **A browser with previews:** hear grooves, samples, presets and amp models before dropping them in, with favorites and recent items.
21. **More templates:** guitar recording, podcast and beat-making setups with the routing already wired.
22. **Clear warnings for silent states:** "track muted by solo", "monitoring is on but no input", "this effect is bypassed".

### Visual and comfort

23. **One consistent style for windows.** Effect windows, the Keys window and the Drum Rack each look and behave differently.
24. **Light theme and adjustable UI size,** for laptop screens and 1440p/4K monitors.
25. **Remember the layout:** panel sizes, folded tracks, the open FX rack and zoom, per project.
26. **Detach or second-screen windows** for the mixer and piano roll (Ableton 12, Logic).

### Accessibility and settings

27. **Keyboard navigation of the timeline, screen-reader labels, and focus handling in dialogs.** Only about 20 places in the interface handle dialog focus or keyboard focus today.
28. **A real Preferences window** (audio device, buffer size, default count-in, autosave, theme) instead of settings scattered across popovers.
