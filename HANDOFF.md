# Handoff: the native engine (stage 3 done, what's next)

Where the desktop app's native audio engine stands, how the work is done,
and what comes next. Written 2026-10-18, at `main` = `95727ac` (PR #13
merged).

## The project, briefly

The Dawn Project is a browser DAW, also built as a desktop app.

- **Web app:** Next.js 16 (static export), TypeScript, Tailwind v4,
  Tone.js. `AGENTS.md` says this Next.js has breaking changes: read
  `node_modules/next/dist/docs/` before writing Next-specific code.
- **Desktop app:** Tauri 2 (`src-tauri/`). It shows the same studio in a
  native window, and adds a Rust audio engine that plays through the
  interface's own driver (Core Audio, WASAPI; ASIO behind the cargo
  feature `asio`, off).
- **Rust workspace:**
  - `crates/dawn-engine`: the engine. Plain Rust, no dependencies.
  - `crates/dawn-plugins`: VST3/CLAP plugin scanning.
  - `crates/dawn-test-plugin`: a test plugin.
  - `src-tauri`: the desktop app.
- **Repo:** `angelzxz1/The_Dawn_Proyect`. Default branch `main`.

## Goals and the user's decisions

- **Original goals:** ASIO, and third-party plugins (VST3, CLAP, AU) on
  Windows and macOS.
- **Order:** the user chose "Native engine first". The native engine
  should play everything the browser engine plays before the plugin work
  continues. The stages:
  1. Playback through the device. Done.
  2. Instruments. Done (PRs #7, #8).
  3. Effects. Every effect with its own DSP kernel is done (PRs #9–#13),
     and of those built from Web Audio nodes all but the Tuner (below).
     NAM remains.
  4. Sidechains and automation. Delay compensation was planned here and
     was brought forward into stage 3 (PR #11).
  5. Live input and recording.
  6. Then the plugins: P2 CLAP effects, P3 VST3 effects, P4 plugin
     instruments, P5 Audio Units.
- **ASIO: decided later.** The options:
  - Steinberg's ASIO licence agreement, signed by the owner (my
    recommendation, since `LICENSE.md` keeps Dawn proprietary). It's
    free; once both sides sign, the About window and the site's download
    and legal pages must carry "ASIO is a trademark of Steinberg Media
    Technologies GmbH, registered in Europe and other countries" (with
    the ASIO compatible logo on the site), and the SDK must never go in
    the repository.
  - The GPLv3 ASIO SDK, which would make every build with ASIO GPLv3.
  - Staying on WASAPI.

  On 2026-10-30 the user said they'll take this up once they consider
  the DAW finished. Keep ASIO off (cargo feature `asio`) until they
  confirm Steinberg has signed.

- **Standing constraint (the user's words):** "Remove any github links or
  sponsors or any link related to github as well any message saying
  github. All feedback will be done via discord." This applies to app and
  site content. Repository docs may mention GitHub (CI, installers), but
  prefer other links.

## How the work is done (conventions)

**Branch:**

- For now (since 2026-10-29), work on `main`: the user said "Let's work
  for now on main always. I'll let you now when we'll create a new
  branch." Leave the changes uncommitted and give the user the commit
  command; they commit it themselves.
- Before that, work went on `claude/busy-rubin-wagwyi`, restarted from
  main after each merge.

**Commits** end with:

```
angelzxz1
```

**One PR per stage or batch:**

- Subscribe to the PR's activity and set a `send_later` check-in (about
  50 minutes).
- Merge when CI is green and `mergeable_state` is clean. The MCP merge
  needs the full 40-character `expectedHeadSha`.
- After merging: unsubscribe, delete the check-in, restart the branch.

**Checks before every push:**

- `cargo fmt --all --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test --workspace`
- `npx tsc --noEmit`
- `npm run lint`
- `npx vitest run` (620 unit and component tests on 2026-10-30). The
  component tests have a 30 s limit (`vitest.config.ts`), and the slow
  unit tests their own; no `--testTimeout` needed.
- `npx playwright test` (149 tests, 1 skipped). It serves `out/`, so run
  `npm run build` first or it tests the last build. On Windows on 2026-10-30,
  four site page tests failed on 404s for resources `serve` didn't find
  (`site.spec.ts`). The credits one was checked on `main` without the day's
  changes and failed the same way.

CI (`.github/workflows/ci.yml`) runs `cargo test -p dawn-engine -p dawn-plugins`,
clippy and fmt. `desktop.yml` builds on Windows, macOS and Linux.

**Writing style for code and docs:** plain, short sentences in the
codebase's voice. Comments say what something is for. Match the
surrounding comment density.

## Key techniques

### Parity ports (how a kernel moves to Rust)

Each JavaScript kernel (kept as source text so worklets and tests run the
same code) is ported step for step:

- `f64` state and `f32` buffers, with `as f32` wherever the JavaScript
  writes to a Float32Array.
- The arithmetic in the same order.
- `js_round(x) = (x + 0.5).floor()`, `pub(crate)` in `instruments/mod.rs`.
- AudioParams are float32 and clamped to their ranges, so ports clamp and
  round to f32 the same way (see `pitch_shift.rs`, `ShifterParams`).

A fixture holds each port to the JavaScript:

- `src/effects/<name>/<name>Parity.ts` renders the cases with the JS
  kernel, the way its worklet runs it (128-frame blocks, meters every N
  frames).
- `<name>Parity.test.ts` calls
  `describeEngineFixture(what, fixtureName, testName, render)`
  (`src/test/engineFixtures.ts`).
- The output is `crates/dawn-engine/tests/fixtures/<name>.{rs,bin}`.
  Remake it with `UPDATE_ENGINE_FIXTURES=1 npx vitest run --project unit <testName>`.
- `crates/dawn-engine/tests/<name>_parity.rs` renders the same cases in
  Rust with `FixtureReader` and `Signal` (`tests/common/mod.rs`), with a
  tolerance of 1e-5. Run with `-- --nocapture` to see the largest
  difference per case.
- Shared constants (`src/test/kernelParity.ts`): SR 48000, FRAMES 19200,
  BLOCK 128, STRIDE 17. Kernels are evaluated with
  `new Function(SOURCE + "; return Kernel")()`.
- Results so far: bit-exact everywhere except the Furnace amp, which is
  within one float32 step (at most 1.5e-8). That's probably last-bit
  differences between V8's `tanh`/`pow` and libm, compounded at 4x rate.

To add an effect, follow `docs/desktop.md` → "Porting the next kernel":

1. Write `effects/<name>.rs` and register it in `effects/mod.rs`, adding
   its key to `PORTED`.
2. Add an `EffectSettings`/`Kernel` variant in `mix/fx.rs` (box large
   settings), and its `latency()` if it has any.
3. Add the key to `NATIVE_EFFECTS` in `src/engine/native/describe.ts`. A
   test checks it matches `PORTED`.
4. Update the panel text (`src/studio/transport/NativeEngineSection.tsx`)
   and `docs/desktop.md`.

### Engine model (`crates/dawn-engine/src/mix/`)

**Preparing a song:**

- `Song::prepare(previous, sr)` runs off the audio thread. It builds
  every buffer, instrument (`Player`), effect, delay line and the
  compensation plan.
- `Engine::set_song` swaps in, from the version already playing, the
  instruments (by track id and kind), effects (by effect id and kind) and
  delay lines (by id and length), so an edit never cuts audio off.
- The audio thread never allocates. The amp's tone-stack refit uses
  fixed arrays for that reason.

**Effect chains (`mix/fx.rs`):**

- Where they run:
  - a track's after its sources, before its fader;
  - a bus's on its sends;
  - the master's after its fader, before the limiter.
- A bypassed effect is skipped and keeps its state.
- Multiband kernels work out their glide per call, so they run in
  128-frame chunks.

**Delay compensation (`mix/latency.rs`):**

- A port of `src/engine/latency.ts` `planCompensation`, in frames.
- The delays: own (a group's own sources), channel (after a track's
  effects), send, bus, and a shared direct path to the master.
- Live tracks (the armed MIDI track, and what it plays through) skip
  compensation and go straight to the master.
- The clicks wait the total.
- The studio sends `compensation` (the Audio panel's setting) and
  per-track `live` through the follower (`src/engine/follower.ts`
  `compensation()`).

**Effect latencies:**

- Limiter: its lookahead, 240 frames at 48 kHz.
- Glue Compressor with oversampling: 15.
- Pitch Shift: window·sr/2 + 2.
- Furnace: 16.

**Sidechains:** not in the engine yet. `describe.ts` leaves out effects
whose sidechain is `on && source`, and the panel lists them as
"(sidechained)". Keyed by their own input instead, a ducking compressor
would squash what it ducks.

### Testing in the real desktop app (the "probe")

Temporary, never committed:

1. Back up `src-tauri/src/lib.rs` (and `src-tauri/src/audio/mod.rs` if
   you add logging).
2. Add a `probe_log` command, plus an `on_page_load` hook that evals the
   JavaScript file named by the `DAWN_PROBE` environment variable:

   ```rust
   #[tauri::command]
   fn probe_log(message: String) { eprintln!("[probe] {message}"); }
   // in run(), on the Builder:
   .on_page_load(|webview, payload| {
       if payload.event() == tauri::webview::PageLoadEvent::Finished
           && let Ok(path) = std::env::var("DAWN_PROBE")
           && let Ok(js) = std::fs::read_to_string(path)
       { let _ = webview.eval(js); }
   })
   // and add probe_log to invoke_handler, next to engine_info.
   ```

   For song details, an `eprintln!` in `engine_set_song` (`audio/mod.rs`)
   printing `built.compensation`, `prepared.latency()` and the chain
   kinds works well.

3. Build with `npm run build`, then
   `cargo build -p dawn-desktop --features tauri/custom-protocol`, then
   restore the backed-up files at once and check `git diff`.
4. Run under
   `xvfb-run -a -s "-screen 0 1600x1000x24" target/debug/dawn-desktop`,
   with `XDG_DATA_HOME`, `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` pointed
   into a scratch folder.
   - The probe JavaScript sets
     `localStorage["dawn.audioPrefs.v1"] = {nativeEngine:false, nativeDevice:"alsa:null"}`
     and reloads.
   - Then it opens the Beat template, turns the Native engine switch on in
     the Audio panel, adds effects by clicking
     `div[title^="Drag onto the FX rack"]` entries, plays, calls
     `invoke('engine_loop', {start:0,end:30})`, and logs
     `invoke('engine_status')`.
   - Headless runs sometimes stall ("IPC custom protocol failed"). Retry
     up to 4 times.
   - The probe scripts lived in the old container's scratchpad and are
     gone. Rebuild them from this description.

## Files touched this session (stage 3)

**PR #10 (Gate, Glue, Parametric EQ, multiband effects):**

- `crates/dawn-engine/src/effects/{gate,glue,param_eq,multiband,mb_dynamics}.rs`
- `effects/sidechain.rs` (`KeyFilter::active()`, `gain()`)
- `mix/fx.rs`
- `tests/{gate,glue,param_eq,multiband,mb_dynamics}_parity.rs` and
  their fixtures
- `src/effects/{gate,glue,parametric-eq,multiband,multiband-dynamics}/*Parity{,.test}.ts`
- `describe.ts` and `describe.test.ts` (the test that compares
  `NATIVE_EFFECTS` with `PORTED`)
- `NativeEngineSection.tsx`, `docs/desktop.md`

**PR #11 (delay compensation):**

- `mix/latency.rs` (new; planner, `Ring`, `Delay`, unit tests)
- `mix/song.rs`: `Track.live`, `Song.compensation`, and on `Prepared` the
  `plan`, the delays and `latency()`
- `mix/engine.rs` (runs and swaps the delays; the clicks wait the total)
- `mix/fx.rs` (`EffectSettings::latency`, `fx::latency`)
- `effects/limiter.rs` (`lookahead_frames`)
- `tests/latency.rs`
- `src-tauri/src/audio/song.rs`: `live` and `compensation`, which
  defaults to true
- `src/engine/follower.ts`, `audioEngine.ts` (`refreshMix` and
  `setFollower` call `follower.compensation`)
- `native/nativeEngine.ts`, `describe.ts` (`NativeSession`)

**PR #12 (Pitch Shift):**

- `effects/pitch_shift.rs` (`PitchShiftKernel`, `ShifterParams`,
  `PitchShifter`)
- `src/effects/pitch-shift/pitchShiftKernel.ts` (the worklet source,
  moved unchanged out of `pitchShifter.ts`)
- `pitchShiftParity{,.test}.ts`, `tests/pitch_shift_parity.rs`

**PR #13 (Furnace amp):**

- `effects/amp.rs`: `AmpSettings::from_params` with the voicings,
  `AmpKernel`, and `AmpEffect` (mono mix to both sides)
- `src/effects/furnace/ampParity{,.test}.ts`, `tests/amp_parity.rs`
- `tests/effects.rs`: the every-type chain test now feeds a 220 Hz tone,
  because the amp blocks DC

## Current state

- `main` = `claude/busy-rubin-wagwyi` = `95727ac`. Nothing is open, and no
  check-ins are scheduled.
- **The native engine plays:**
  - audio clips;
  - every instrument (piano, Drum Rack, synth), from clips and live keys;
  - the mix: volume, pan, mute, solo, groups, sends, buses;
  - effects `PORTED` = chorus, compressor, delay, distortion (the
    Saturator), eq3, filter, gate, glue, irLoader, limiter, mbDynamics,
    multiband, paramEq, pitchShift, reverb, tubeAmp, utility;
  - delay compensation, the master limiter and the metronome.
- **The panel lists what it doesn't play:**
  - instruments it lacks;
  - effects: those not ported, plus sidechained ones;
  - tracks with automation.
- **Not yet in the engine:** the Tuner, NAM, sidechains, automation,
  recording.

## Next steps

1. **The Web Audio-node effects.** Their parity can't be checked in node,
   because the nodes don't run there, so their fixtures are rendered in
   Chromium: `src/test/webAudioParity.ts` plays the test signal through
   the studio's own nodes in an OfflineAudioContext, in Vitest's
   `web-audio` project (`<name>Parity.webaudio.test.ts`). Done, on ports
   of Chromium's nodes:
   - The Filter and the EQ Three: BiquadFilterNode (`effects/biquad_node.rs`).
   - The Chorus and the Delay: DelayNode (`effects/delay_node.rs`) and
     Tone's LFO (`effects/tone_lfo.rs`: Chromium's wave-table oscillator,
     AudioToGain's WaveShaper, Scale). The Filter's LFO uses it too.
   - The Saturator: WaveShaperNode with its 2x/4x oversampling
     (`effects/wave_shaper.rs`, Blink's `UpSampler`/`DownSampler`).
   - The Reverb and the IR Loader: ConvolverNode (`effects/convolver.rs`),
     done 2026-10-30. Chromium's is the plain convolution with no latency
     (probed: a mono impulse convolves each side; four channels mix
     L←L·h0+R·h2, R←L·h1+R·h3; a mono input acts as stereo). The port
     works it out its own way: the first 128 taps directly, then FFT
     partitions of 128 (to tap 2048), 1024 (to 16384) and 8192, the longer
     two starting two blocks in so their work (FFT steps and products, as
     jobs) spreads over a block's quanta. A 10 s Reverb takes about 3% of
     a core in release, a 20 s true-stereo IR about 5%; the worst
     256-frame block about 1 ms.
     - The Reverb's impulse is `renderImpulse` ported step for step
       (`reverb.rs`). It matches Chromium to 1e-7 in every case, swaps
       included.
     - A new impulse is made when the song is prepared, off the audio
       thread (`EffectSettings::prepare`, now given the same effect's
       settings in the previous song, so an unchanged impulse is kept).
       The app prepares effects on the song it keeps to follow
       (`Song::prepare_effects` in `engine_set_song`), or every song would
       re-render it. An `ImpulseSlot` carries the impulse and a convolver
       made for it; the audio thread takes it (`Convolution::take`, a
       `try_lock`), and the replaced one rings out (up to 2 at once);
       those rung out go back into the slot, to be freed off the audio
       thread.
     - The IR Loader's file is sent like a clip's (`${rate}:file:<id>`,
       `NativeAudioIds.effectFile`, decoded by `decodeEffectFileAudio`);
       while a new one is on its way the effect keeps the one it had, as
       the browser does.
     - Chromium quirk ported: a ConvolverNode whose input is gone works on
       a mono input, so a mono impulse rings out mono (the left tail on
       both sides).
     - Chromium races, not ported and kept out of the fixture: after a new
       ConvolverNode is connected (an IR swapped in), or one turns mono
       (a mono IR taken out), the BiquadFilters after it sometimes start
       afresh and sometimes not, run to run (their channel count changes
       for a quantum or not). The port carries the filters on.
     - The IR Loader's low cut comes after the convolver, and Off is a
       5 Hz high pass, which turns last-bit differences into drift:
       `ir_loader_parity.rs` holds cases with the cut on to 5e-5 and those
       at Off to 5e-3.
     - The parity harness (`webAudioParity.ts`) now takes files
       (`WebAudioFiles`, a case's `file`), and waits 150 ms at a change
       before resuming, so the Reverb's 40 ms rebuild lands on the
       change's frame.

   They match Chromium to the last bit or a float32 rounding, except where
   an LFO sweeps: Chromium's wave tables come from its FFT, ours are
   summed, so they differ in the last bit. That's under 6e-6 on the Filter,
   and up to 2e-4 on the Chorus (it moves a delay's read position by one
   float32 step now and then); `chorus_parity.rs` allows 5e-4.

   The Saturator is exact without oversampling. With it,
   `saturator_parity.rs` allows 5e-3: the Chromium the tests run (141)
   downsamples with an FFT convolution, the port with the direct one
   Chromium's main branch now uses, and that last-bit difference grows
   into a slow drift of a few 1e-4 in the DC blocker after the shaper (a
   float32 10 Hz high pass with its poles right by DC; Chromium's own
   output drifts as much with its input's last bits). Its latency is what
   the studio measures in Chrome: 128 frames at 2x, 192 at 4x. The
   studio's fallback said 129/193 until this change.

   The ports copy Chromium's graph quirks, since that's what the studio
   plays:
   - A feedback loop runs a block at a time, so what comes back is 128
     frames late. With Ping-Pong only the right side waits.
   - The Chorus's right delay reads its splitter in place. That gives it
     no input in its first block, and odd input for one block whenever the
     feedback loop is wired or unwired (`RightInput` in `chorus.rs`).
   - Tone's LFO sets its "stopped" value whenever its type or phase
     changes, even while running. After a Spread or waveform change, that
     offset stays added to the wave (`initial_value` in `tone_lfo.rs`).

   The rest:

   | Key          | Folder       | Label     | Notes                                                 |
   | ------------ | ------------ | --------- | ----------------------------------------------------- |
   | `tuner`      | `tuner/`     | Tuner     | passes audio through, but the studio reads its pitch  |

   The Tuner is the last: the engine has to report its pitch back.

2. **NAM** (`namAmp`, `nam-amp/`). Its engine is C++
   (NeuralAmpModelerCore) and can be built into the engine as is, with
   the model files sent over.
3. **Sidechains:** keys routed from other tracks, with the browser's tap
   points and latency alignment (`mixGraph.ts` `resolveSidechains`,
   `keyDelay`). Then **automation**.
4. **Live input and recording through the engine:** the interface's
   inputs, low-latency monitoring, takes written to disk.
5. **Plugins:** P2 CLAP effects in the engine (with their windows and
   state saved), P3 VST3 effects, P4 plugin instruments, P5 Audio Units.
6. **Export** through the engine, native file dialogs, signed installers.

**Smaller items:**

- **IMPROVEMENTS.md** (checked against the code on 2026-10-29). It has
  checkboxes, and each finished item names the commit that did it.
  - Part 1 (code) is all done.
  - Part 2 (UX) items 1–7 are done. Item 7, section markers, was added
    on 2026-10-30 (`src/project/markers.ts`, `src/state/markerActions.ts`,
    `src/studio/transport/MarkerLane.tsx`, `e2e/markers.spec.ts`), in
    `23dbe29`. The next release's "What's new" (`src/content/whatsNew.ts`)
    should mention it.
  - Items 8–28 are open; 8, 12, 16, 20, 21 and 25 are partly there. Next
    up is 8, snap that adapts to zoom and snaps to clip edges.
  - The project document now has `markers` (in beats). The native engine
    ignores them; they only move the playhead and the loop.
- **The order of what's left** is in `nextSteps.md`, which is kept
  locally (it's in `.gitignore`). Phase 2's first step (the Convolver:
  the Reverb and the IR Loader) was done on 2026-10-30; next is the
  Tuner. Phase 1 (housekeeping) was done on 2026-10-30: the slow tests got longer limits, a flaky ClipBlock
  double-click test clicks twice in one go, and the JS multiband kernels
  read the band count and their key per sample, as the Rust ports do.
