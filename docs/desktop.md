# The desktop app

Dawn is becoming an installable desktop app as well as a website. The
desktop app is built with [Tauri 2](https://v2.tauri.app): the same studio
(the static site `npm run build` makes) in a native window, with a Rust side
that will take over the audio from Web Audio. That's the way to low-latency
recording through audio interface drivers (ASIO on Windows, Core Audio on
macOS) and, later, hosting installed VST3 and CLAP plugins.

It's early. Today:

- **The window works**: `npm run desktop` opens the studio in its own
  window, and `npm run desktop:build` makes installers.
- **The native engine plays audio (beta)**: turned on in the Audio panel
  (the CPU meter in the transport bar), it plays the song through the audio
  interface's own driver - Core Audio on macOS, WASAPI on Windows (ASIO once
  its licence is signed, below). So far it plays the audio clips and every
  instrument through the mix (volume, pan, mute, solo, groups, sends), the
  dynamics and EQ effects, the Filter, the Chorus, the Delay, the Reverb,
  the Saturator, the Pitch Shift, the Furnace amp, the IR Loader and the
  Tuner, with delay compensation, the master limiter and the metronome.
  Sidechains, automation and recording still need the browser's engine,
  and the NAM Amp stays a browser effect (on the desktop, NAM models are
  meant to play through NAM's own plugin, once plugins run in the
  engine): the
  panel says what of the project it doesn't play yet, and Record asks to
  turn it off.
- **The DSP is moving over**: `crates/dawn-engine` holds the kernels ported
  to Rust so far - the instruments, the dynamics and EQ effects, the
  Filter, the Chorus, the Delay, the Reverb, the Saturator, the Pitch
  Shift, the Furnace amp, the IR Loader, the Tuner, the metronome and clip
  playback - each tested against the JavaScript's own output, or for the
  effects built from Web Audio nodes, Chromium's (below).

## Getting the installers

GitHub makes them on every push to `main`
(`.github/workflows/installers.yml`): a `.dmg` for macOS, one app for both
Apple Silicon and Intel Macs, and an `.msi` and a setup `.exe` for Windows.

1. On the repository's page on GitHub (signed in), open **Actions →
   Desktop installers**, and the newest run with a green check.
2. Under **Artifacts** at the bottom, download **Dawn-macOS** or
   **Dawn-Windows** (a `.zip` with the installer in it). Runs keep them for
   30 days; **Run workflow** on that page makes a fresh set.

They aren't signed with a developer certificate yet (that takes an Apple
Developer account and a Windows code-signing certificate), so each system
asks once:

- **macOS**: open the `.dmg` and drag Dawn to Applications. The first time
  you open it, macOS says it can't verify the developer: click **Done**,
  then **System Settings → Privacy & Security**, scroll down to the note
  about The Dawn Project and click **Open Anyway**. (On macOS 14 and older,
  right-click the app → **Open** does it.) The Mac app is signed ad hoc
  (`signingIdentity: "-"` in `tauri.conf.json`), which is what lets it open
  this way instead of being called damaged; a Developer ID replaces it
  later.
- **Windows**: run the `.msi` or the setup `.exe`. If SmartScreen says it
  protected your PC, click **More info → Run anyway**.

## Running it

You need, once:

- **Rust** (stable, 1.90 or newer), from [rustup.rs](https://rustup.rs).
- **Windows**: Microsoft C++ Build Tools ("Desktop development with C++")
  and WebView2, which Windows 10 and 11 already have.
- **macOS**: Xcode's command line tools (`xcode-select --install`).
- **Linux**: Tauri's libraries, e.g. on Ubuntu
  `sudo apt install libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libasound2-dev build-essential`.

Then:

```bash
npm run desktop          # the dev server in the app's window, with hot reload
npm run desktop:build    # installers, in target/release/bundle/
npm run test:engine      # the native engine's tests (cargo test -p dawn-engine)
```

Both `desktop` scripts run the Tauri CLI through `npx`. The first build
compiles a few hundred Rust crates and takes several minutes; later ones
only rebuild what changed. `Cargo.lock` is committed, so every machine
builds the same dependencies.

## How it's put together

- `Cargo.toml`: the Rust workspace (the engine, plugin hosting and the
  app).
- `src-tauri/`: the app.
  - `tauri.conf.json`: the window (opening the studio at `/app`), the site
    it serves (`out/`, built by `npm run build` before each app build), and
    the bundle (name, icons, macOS entitlements). Its version is
    `package.json`'s.
  - `src/lib.rs`: starts the app; lets the studio's own pages use the
    microphone and MIDI without the webview asking on every launch; and the
    commands the studio can call.
  - `src/audio/`: the native engine's side in the app - the audio devices
    (`devices.rs`, through [cpal](https://github.com/RustAudio/cpal)), the
    stream that plays the engine (`stream.rs`), and the commands the studio
    drives it with (`mod.rs`).
  - `src/plugins.rs`: the plugin scan in the background, its cache and the
    folders searched, and the commands the studio's Plugins tab calls.
    `src/main.rs` runs the scan's side when the app is started with
    `--scan-plugin` (below).
  - `capabilities/default.json`: what the window may use of Tauri's own API.
  - `Info.plist`, `Entitlements.plist`: macOS's microphone prompt text and
    permission, and the hardened runtime's leave to load plugins signed by
    others (library validation off, and the JIT some plugins use).
  - `icons/`: made from `public/icons/icon-512.png`. To remake them from a
    new image: `npx @tauri-apps/cli@2 icon path/to/icon.png`.
- `crates/dawn-engine/`: the native engine.
- `crates/dawn-plugins/`: VST3 and CLAP plugin hosting (so far, finding
  them), and `crates/dawn-test-plugin/`, a small plugin in both formats
  that its tests load.
- `src/engine/native/`: the native engine from the studio's side (below).
- `src/services/desktop.ts`: `isDesktopApp()`, for the studio to tell where
  it's running. The service worker stays off in the app (`AppUpdater.tsx`):
  its files are already on disk, and it updates with its installer.

The window turns off Tauri's own file drop handling (`dragDropEnabled`) so
that dropping audio files on the timeline works as in the browser.

## What's different in the app today

The window is the system's webview, not Chrome, so a few browser features
depend on the platform:

- **Windows** uses WebView2, which is Chromium: the studio should behave as
  in Chrome or Edge.
- **macOS** uses WKWebView (Safari's engine) and **Linux** WebKitGTK. Neither
  has the File System Access API, so projects save as a single
  `.dawnproject` file rather than to folders, nor Web MIDI, so MIDI
  controllers don't work there yet. On macOS the system asks once for the
  microphone. Recording on Linux is untested.
- Links to other sites don't open in your browser yet; that needs Tauri's
  opener plugin.

These differences go away as the native side takes over each job: audio
and MIDI devices through the engine, files through native dialogs.

## The native engine

`crates/dawn-engine` is plain Rust with no dependencies:

- `mix/`: what plays the song - the transport (play with a count-in, stop,
  seek, the loop), audio clips, the strips (fader, Web Audio's stereo
  panner, mute), tracks feeding other tracks, post-fader sends, buses, the
  master fader and limiter, and the metronome after the limiter. Delay
  compensation (`mix/latency.rs`, planned as the browser's `latency.ts`)
  lines every path up at the master: effects that delay their audio (a
  limiter's lookahead, oversampling) hold the other tracks, sends and buses
  back to match, the armed MIDI track plays without waiting, and the clicks
  wait as long as the mix. It renders for whatever asks for samples: the
  app's audio stream, or (later) a file.
- `effects/`: the DSP kernels, each a port of a JavaScript one from
  `src/effects/` that computes the same thing step for step: the same `f64`
  state and `f32` buffers as the JavaScript's numbers and Float32Arrays, the
  arithmetic in the same order. So far the Compressor, the Glue Compressor,
  the Noise Gate, the Limiter, the Multiband Compressor, Multiband Dynamics,
  the Parametric EQ, the Pitch Shift, the Furnace amp and the Utility. The
  Filter, the EQ Three, the Chorus, the Delay, the Reverb, the Saturator
  and the IR Loader are built from the browser's nodes (BiquadFilter,
  Delay, WaveShaper, Convolver, and Tone.js's LFO), so they're ports of
  Chromium's (`biquad_node.rs`, `delay_node.rs`, `wave_shaper.rs`,
  `convolver.rs`, `tone_lfo.rs`)
  and the studio's wiring of them, down to how Chromium runs a feedback
  loop a block at a time. They
  run in the tracks', buses' and master's chains where the browser's do
  (`mix/fx.rs`): a track's on what it plays and what's routed into it, ahead
  of its fader; a bus's on its sends; the master's after its fader, ahead of
  the limiter. Each effect lives on from one version of the song to the next
  by its id, and a bypassed one is skipped, keeping its state.
- `instruments/`: the instruments, the same way: the Drum Rack's kernel
  (a port of `drumKernel.ts`), the synth's (a port of `synthKernel.ts`,
  playing the wavetables the studio builds), and the piano, a sampler that
  plays as Tone.js's Sampler does (the nearest sample, pitched by its
  playback rate, the velocity as its gain, Tone's release curve). A MIDI
  track's
  instrument plays its clips' notes on their sample and the keys played
  live; it lives on from one version of the song to the next
  (`mix/player.rs`), so an edit doesn't cut off what's ringing, and
  stopping, jumping or looping back releases the clips' notes.

The rules for what runs on the audio thread: no allocation, locks, I/O or
panics. Everything it needs is made beforehand (`Song::prepare`), and what
it replaces goes back to be freed elsewhere.

### How the studio drives it

The studio describes the song (`src/engine/native/describe.ts`): every
track's level, pan and clips, whether it's heard (mute and solo, worked out
by the same code as the browser's engine), where it goes, its sends, and a
MIDI track's notes (as the browser plays them: clamped or tiled to their
clips) and instrument (the Drum Rack's compiled kit, the synth's compiled
patch, or the piano); the buses, the master and the tempo map.
`nativeEngine.ts` sends that whenever the project changes, and each audio
file once, decoded at the device's rate: a clip's (a warped clip sends its
rendering), a sample pad's, the piano's samples, and a synth's wavetables
(its mip levels one after another, as one channel). Until a synth's tables
are in it waits to play, as in the browser, and while a new table is on its
way it keeps the one it had. The browser's engine keeps running, silently:
its transport tells the native engine everything it does
(`src/engine/follower.ts`), as do the keys played live (the on-screen keys,
the computer keyboard, a MIDI controller), the sustain pedal, pitch bend
and the mod wheel, and the playhead takes the native engine's position. So
the rest of the studio doesn't change while parts move over.

The studio sends each chain's effects the engine has (with their
parameters as the project keeps them, `NATIVE_EFFECTS` in `describe.ts`);
a chain plays without the others, and without an effect keyed by another
track (sidechains aren't in the engine yet; keyed by its own input, a
ducking compressor would squash what it ducks). What it doesn't play yet -
those effects, automation - the Audio panel names for the project open.

### ASIO

cpal's ASIO backend builds with Steinberg's ASIO SDK, which is GPLv3 or
Steinberg's own licence. Dawn isn't GPL, so it needs Steinberg's licence
agreement, signed, before an installer with ASIO goes to anyone. Until then
it's off: the app builds with `--features asio` (on Windows, with LLVM
installed for the SDK's bindings; cpal fetches the SDK itself, or reads it
from `CPAL_ASIO_DIR`), and the installers are made without it. WASAPI works
in the meantime.

### Parity tests

A kernel's parity test proves the port renders what the JavaScript renders:

1. A `<name>Parity.ts` next to the JavaScript (`src/effects/<effect>/`,
   or `src/engine/` for the metronome and clips) defines cases (parameters,
   which inputs and sidechain are connected, a settings change midway, a
   session of transport commands) and renders them with the JavaScript the
   way the browser runs it (128-frame blocks, meters read every 512
   frames).
2. That's stored as a fixture in `crates/dawn-engine/tests/fixtures/`: a
   generated Rust file with the cases and the settings the JavaScript made
   of their parameters, and a binary file with the rendered samples and
   meters.
3. `npm test` checks the fixture is still what the JavaScript kernel
   renders, so a change to the kernel fails until the fixture is remade:
   `UPDATE_ENGINE_FIXTURES=1 npx vitest run --project unit <effect>Parity`.
4. `cargo test -p dawn-engine` renders the same cases with the Rust kernel
   and compares, sample by sample, to within -100 dB. (The Limiter, the
   metronome and clips match to the last bit; the Compressor too, but for
   its meters, by around 1e-14.)

Both sides build the test signal themselves, from the same steps
(`src/test/kernelParity.ts` and `crates/dawn-engine/tests/common/mod.rs`);
the fixture keeps its hash to catch the two drifting apart.

The effects built from Web Audio nodes (the Filter, the EQ Three, the
Chorus, the Delay, the Reverb, the Saturator, the IR Loader) have no
kernel of ours to run in Node, so their fixtures are rendered in Chromium
instead (`src/test/webAudioParity.ts`): an OfflineAudioContext plays the
test signal through the same nodes the studio builds, and a midway change
is made through their `set()` while the render is suspended. The tests are
`<name>Parity.webaudio.test.ts`, in Vitest's `web-audio` project; remake
a fixture with
`UPDATE_ENGINE_FIXTURES=1 npx vitest run --project web-audio <name>Parity`.
The ports follow Chromium's code (`biquad.cc`, `biquad_filter_handler.cc`,
`delay.cc`, `oscillator_handler.cc`, `periodic_wave_handler.cc`,
`wave_shaper_handler.cc`, `up_sampler.cc`, `down_sampler.cc`), and match
it to the last bit or within a float32 rounding, with these exceptions:

- Where an LFO sweeps something: Chromium makes the LFO's wave tables with
  its FFT and the port sums them, so they differ in the last bit. That's a
  few millionths on the Filter, and up to two ten-thousandths on the
  Chorus, where it now and then moves a delay's read position by one
  float32 step.
- The Saturator's oversampling. The Chromium the tests run (141) downsamples
  with an FFT convolution; the port runs the direct one Chromium has moved
  to. That's a float32 rounding on the shaped signal, but the DC blocker
  after it (a float32 10 Hz high pass, its poles right by DC) turns roundings
  into a slow drift, in Chromium too: a few ten-thousandths, up to two
  thousandths after a +12 dB Output. Without oversampling it's exact.
- The convolutions (the Reverb, the IR Loader). Chromium convolves in
  partitions through float32 FFTs; `convolver.rs` works out the same
  convolution, with no latency, its own way: the first 128 taps directly,
  then FFT partitions of 128 and of 1024, the long ones' work spread over
  a block's quanta. The sums differ in their last bit. That's all the
  Reverb shows (its cuts come before the convolver), but the IR Loader's
  low cut comes after it, a float32 high pass that turns last bits into
  drift as the Saturator's DC blocker does: a few hundred-thousandths at
  50 Hz, a few thousandths at Off (5 Hz).

The IR Loader's fixture loads test impulses made from the same arithmetic
on both sides (`parityImpulse`, and `impulse` in `ir_loader_parity.rs`).
It has no case that swaps an IR in, or takes a mono one out: Chromium
renders those differently from run to run (the cuts after a new
ConvolverNode, or after one whose output turns mono, sometimes start
afresh). The port carries the cuts on, which is one of the ways Chromium
renders it; its unit tests cover the swap.

The Tuner passes its input through (Mute fades it, as its Gain's
`rampTo` does) and keeps the last 4096 samples of the left side, as its
one-channel Analyser does, in a `TunerTap` the settings carry. The app
keeps the song, so `engine_tuner` reads the tap from there, off the audio
thread, and the Tuner's window finds the pitch in it while the native
engine plays (`useTuner`, `nativeEngine.tunerInput`).

A new impulse (the Reverb's shape knobs, another IR file, Normalize) is
made off the audio thread when the song is prepared, and kept from one
version to the next while it's the same (the app prepares the effects on
the song it keeps to follow, `Song::prepare_effects`). The audio thread
takes it from an `ImpulseSlot`, and the convolver it replaces rings out
its tail with no more input, as the studio's does; those done ringing go
back with the song, to be freed off the audio thread.

### Porting the next kernel

1. Copy the JavaScript kernel into `crates/dawn-engine/src/effects/<name>.rs`
   line by line, keeping its order of operations and its `f64`/`f32` split,
   and add the effect's key to `effects::PORTED`.
2. Write `<name>Parity.ts` and `<name>Parity.test.ts` next to the effect,
   like the Compressor's, and make the fixture with
   `UPDATE_ENGINE_FIXTURES=1`.
3. Add `crates/dawn-engine/tests/<name>_parity.rs` like
   `compressor_parity.rs`, and make it pass.
4. To play it in the chains: give `mix::fx` its settings (from the
   effect's parameters, as its `audio.ts` turns them into the kernel's) and
   its kernel, and add its key to `NATIVE_EFFECTS` in `describe.ts`.

## Plugins

The app finds the VST3 and CLAP plugins on the computer and lists them in
the browser's **Plugins** tab (instruments, effects and note effects, each
with its format). Putting them on tracks comes next; the steps are below.

### Where it looks

The folders each format names for the system, plus any the user adds in
the Plugins tab (kept in `plugin-folders.json` in the app's data folder),
and their sub-folders:

| System  | VST3                                                                                   | CLAP                                                                        |
| ------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Windows | `%LOCALAPPDATA%\Programs\Common\VST3`, `C:\Program Files\Common Files\VST3`            | the same with `CLAP`                                                        |
| macOS   | `~/Library/Audio/Plug-Ins/VST3`, `/Library/Audio/Plug-Ins/VST3`                         | the same with `CLAP`                                                        |
| Linux   | `~/.vst3`, `/usr/lib/vst3`, `/usr/local/lib/vst3`                                      | `~/.clap`, `/usr/lib/clap`                                                  |

`CLAP_PATH`'s folders come first, as CLAP asks.

### How a plugin is read

A plugin's own code runs as it's loaded, and some crash or hang, so the
app never loads one into itself to read it: it runs itself again as
`<app> --scan-plugin <vst3|clap> <path>` for each file (a few at a time),
and that process loads the plugin, writes what it found on its output and
exits. A plugin that crashes takes only that process with it, and one that
takes more than a minute is stopped; the Plugins tab lists those files and
why, and can try them again. On Windows that process shows no crash
dialogs, and on macOS it stays out of the Dock.

- **VST3** (`crates/dawn-plugins/src/vst3.rs`): a bundle's
  `Contents/Resources/moduleinfo.json`, which plugins since VST 3.7.5 ship
  for hosts to read instead of loading them, when it has one. Otherwise its
  binary for this system (`Contents/x86_64-win/`, `Contents/MacOS/` through
  CFBundle, `Contents/x86_64-linux/`, or an older single-file `.vst3`) is
  loaded the way the SDK's own hosting code does it (`InitDll`,
  `bundleEntry`, `ModuleEntry` and their exits), and its factory lists the
  plugins (IPluginFactory2 for each one's categories, maker and version).
  Class ids are written as the SDK writes them, so a plugin has the same id
  on every system and either way it was read.
- **CLAP** (`crates/dawn-plugins/src/clap.rs`, through
  [clack](https://crates.io/crates/clack-host)): the entry's plugin factory
  lists each plugin and its features.

What a scan finds is cached in `plugins.json` in the app's data folder, by
file, with each binary's size and time: the next scan (each time the studio
opens, or the Rescan button) only reads what's new or changed.

### Testing it

`cargo test -p dawn-plugins` builds `crates/dawn-test-plugin` (a gain effect
and a silent instrument, as both a CLAP plugin and a VST3 module, in one
library), lays it out as this system keeps plugins, and scans it for real,
along with a bundle that's only a `moduleinfo.json` and two CLAP files that
crash and hang on purpose. CI runs it on Windows, macOS and Linux
(`desktop.yml`).

## Next steps

1. **Recording through the engine**: the interface's inputs, monitoring
   with low latency, takes written to disk, latency compensation.
2. **Sidechains and automation in the engine.** Every instrument and
   effect plays already, bar the NAM Amp, which stays in the browser (on
   the desktop, NAM's own plugin plays NAM models).
3. **Plugins**: finding them is done (above). Next, CLAP effects running in
   the engine on tracks, with their own windows and their state saved in
   the project; then VST3 effects the same way; then plugin instruments on
   MIDI tracks, played from clips and live; then Audio Units on macOS.
   NAM's plugin is the first VST3 to try: it's how the desktop app plays
   NAM models.
4. **Export through the engine**, native file dialogs, signed installers.

## Checks

Every push tests the engine and plugin hosting (the `engine` job in
`.github/workflows/ci.yml`). `.github/workflows/desktop.yml` builds the app
and tests the plugin scan on Windows, macOS and Linux whenever
`src-tauri/`, `crates/` or the workspace's `Cargo.toml` changes, or when
run by hand from the Actions tab.
`.github/workflows/installers.yml` makes the installers on every push to
`main` (above).
