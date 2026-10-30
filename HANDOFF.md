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
  3. Effects. Every effect with its own DSP kernel is done (PRs #9–#13).
     The Web Audio-node effects remain (below).
  4. Sidechains and automation. Delay compensation was planned here and
     was brought forward into stage 3 (PR #11).
  5. Live input and recording.
  6. Then the plugins: P2 CLAP effects, P3 VST3 effects, P4 plugin
     instruments, P5 Audio Units.
- **ASIO: undecided.** The user said "Tell me more first", and I
  explained the options:
  - Steinberg's ASIO licence agreement, signed by the owner (my
    recommendation).
  - The GPLv3 ASIO SDK, which would make Dawn GPLv3.
  - Staying on WASAPI.

  Keep ASIO off (cargo feature `asio`) until the user confirms the
  licence is signed.

- **Standing constraint (the user's words):** "Remove any github links or
  sponsors or any link related to github as well any message saying
  github. All feedback will be done via discord." This applies to app and
  site content. Repository docs may mention GitHub (CI, installers), but
  prefer other links.

## How the work is done (conventions)

**Branch:**

- Develop only on `claude/busy-rubin-wagwyi`.
- After each merge, restart it from main:
  `git fetch origin main && git checkout -B claude/busy-rubin-wagwyi origin/main && git push -u origin claude/busy-rubin-wagwyi --force-with-lease`.
  Uncommitted work carries over.
- A fresh container may clone the branch at an old commit. Fetch first;
  if the tree is clean, `git merge --ff-only origin/claude/busy-rubin-wagwyi`.

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
- `npx vitest run` (603 tests now)
- `npx playwright test` (146 passed, 1 skipped)

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
  - effects `PORTED` = compressor, eq3, filter, gate, glue, limiter,
    mbDynamics, multiband, paramEq, pitchShift, tubeAmp, utility;
  - delay compensation, the master limiter and the metronome.
- **The panel lists what it doesn't play:**
  - instruments it lacks;
  - effects: those not ported, plus sidechained ones;
  - tracks with automation.
- **Not yet in the engine:** the Web Audio-node effects, NAM, sidechains,
  automation, recording.

## Next steps

1. **The Web Audio-node effects.** Their parity can't be checked in node,
   because the nodes don't run there, so their fixtures are rendered in
   Chromium: `src/test/webAudioParity.ts` plays the test signal through
   the studio's own nodes in an OfflineAudioContext, in Vitest's
   `web-audio` project (`<name>Parity.webaudio.test.ts`). The Filter and
   the EQ Three are done, on a port of Chromium's BiquadFilterNode
   (`effects/biquad_node.rs`); they match Chromium to the last bit or a
   float32 rounding, the Filter's LFO within 1e-5. The rest:

   | Key          | Folder       | Label     | Notes                                                 |
   | ------------ | ------------ | --------- | ----------------------------------------------------- |
   | `chorus`     | `chorus/`    | Chorus    |                                                       |
   | `delay`      | `delay/`     | Delay     | tempo-synced                                          |
   | `distortion` | `saturator/` | Saturator | has `latency` from oversampling                       |
   | `reverb`     | `reverb/`    | Reverb    |                                                       |
   | `irLoader`   | `ir-loader/` | IR Loader | convolution; needs its IR files sent like other audio |
   | `tuner`      | `tuner/`     | Tuner     | passes audio through, but the studio reads its pitch  |

   Each needs its Web Audio node semantics reimplemented (BiquadFilter,
   Delay, Convolver, WaveShaper and so on).

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

- **Flaky synth preset test.**
  `src/instruments/synth/synth.test.ts`, "every factory preset is valid,
  plays, and survives a save/load round trip". It takes about 0.9 s
  alone, but failed once in a full parallel `vitest` run, probably
  hitting the 5 s default timeout. Still open on 2026-10-29: under heavy
  CPU load, other slow tests (ClipBlock, drum kits, wavetables, damaged
  saved data) time out the same way, and all pass with
  `--testTimeout 60000`. Give the slow tests a longer limit.
- **IMPROVEMENTS.md** (checked against the code on 2026-10-29). It has
  checkboxes, and each finished item names the commit that did it.
  - Part 1 (code) is all done.
  - Part 2 (UX) items 1–6 are done.
  - Items 7–28 are open; 8, 12, 16, 20, 21 and 25 are partly there.
- **A latent bug in the JS multiband kernels** (`mbDynamicsModel.ts`, and
  the same pattern in `multibandModel.ts`). `process()` reads the band
  count and `keyed` once per block. A pending band switch that lands
  mid-block (two switches in back-to-back quanta) would read
  `this.coef[b]` past its end. The Rust ports read them per sample.
  Unlikely in practice; worth a small fix.
