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
  interface's own driver - Core Audio on macOS, WASAPI on Windows (ASIO
  once its licence is signed, below). So far it plays the audio clips
  through the mix (volume, pan, mute, solo, groups, sends), the master
  limiter and the metronome. Instruments, effects, automation and recording
  still need the browser's engine: the panel says what of the project it
  doesn't play yet, and Record asks to turn it off.
- **The DSP is moving over**: `crates/dawn-engine` holds the kernels ported
  to Rust so far - the Compressor, the Limiter, the metronome and clip
  playback - each tested against the JavaScript's own output (below).

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
  master fader and limiter, and the metronome after the limiter. It renders
  for whatever asks for samples: the app's audio stream, or (later) a file.
- `effects/`: the DSP kernels, each a port of a JavaScript one from
  `src/effects/` that computes the same thing step for step: the same
  `f64` state and `f32` buffers as the JavaScript's numbers and
  Float32Arrays, the arithmetic in the same order.
- `instruments/`: the instruments, the same way: the Drum Rack's kernel
  (a port of `drumKernel.ts`), and the piano, a sampler that plays as
  Tone.js's Sampler does (the nearest sample, pitched by its playback rate,
  the velocity as its gain, Tone's release curve). A MIDI track's
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
clips) and instrument (the Drum Rack's compiled kit, or the piano); the
buses, the master and the tempo map. `nativeEngine.ts` sends that whenever
the project changes, and each audio file once, decoded at the device's
rate: a clip's (a warped clip sends its rendering), a sample pad's, the
piano's samples. The browser's engine keeps running, silently: its
transport tells the native engine everything it does
(`src/engine/follower.ts`), as do the keys played live (the on-screen keys,
the computer keyboard, a MIDI controller) and the sustain pedal, and the
playhead takes the native engine's position. So the rest of the studio
doesn't change while parts move over.

What it doesn't play yet - the synth, effects, automation - the Audio
panel names for the project open, and those stay silent while the native
engine is on.

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

### Porting the next kernel

1. Copy the JavaScript kernel into `crates/dawn-engine/src/effects/<name>.rs`
   line by line, keeping its order of operations and its `f64`/`f32` split,
   and add the effect's key to `effects::PORTED`.
2. Write `<name>Parity.ts` and `<name>Parity.test.ts` next to the effect,
   like the Compressor's, and make the fixture with
   `UPDATE_ENGINE_FIXTURES=1`.
3. Add `crates/dawn-engine/tests/<name>_parity.rs` like
   `compressor_parity.rs`, and make it pass.

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
2. **Instruments and effects in the engine**: the synth (the Drum Rack and
   the piano play already), then the remaining effect kernels (gate,
   glue, the multiband effects, EQ, utility, pitch shift, the Furnace amp),
   then what's built from Web Audio nodes today
   (chorus, delay, EQ Three, filter, reverb, the IR loader, saturator,
   tuner, the piano sampler). NAM's engine is C++ (NeuralAmpModelerCore) and
   can be built into the engine as is. Then automation and delay
   compensation.
3. **Plugins**: finding them is done (above). Next, CLAP effects running in
   the engine on tracks, with their own windows and their state saved in
   the project; then VST3 effects the same way; then plugin instruments on
   MIDI tracks, played from clips and live; then Audio Units on macOS.
4. **Export through the engine**, native file dialogs, signed installers.

## Checks

Every push tests the engine and plugin hosting (the `engine` job in
`.github/workflows/ci.yml`). `.github/workflows/desktop.yml` builds the app
and tests the plugin scan on Windows, macOS and Linux whenever
`src-tauri/`, `crates/` or the workspace's `Cargo.toml` changes, or when
run by hand from the Actions tab.
`.github/workflows/installers.yml` makes the installers on every push to
`main` (above).
