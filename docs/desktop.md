# The desktop app

Dawn is becoming an installable desktop app as well as a website. The
desktop app is built with [Tauri 2](https://v2.tauri.app): the same studio
(the static site `npm run build` makes) in a native window, with a Rust side
that will take over the audio from Web Audio. That's the way to low-latency
recording through audio interface drivers (ASIO on Windows, Core Audio on
macOS) and, later, hosting installed VST3 and CLAP plugins.

It's early. Today:

- **The window works**: `npm run desktop` opens the studio in its own
  window, and `npm run desktop:build` makes installers. Audio still runs on
  Web Audio inside the window, so it behaves (and its latency is) as in a
  browser.
- **The native engine has started**: `crates/dawn-engine` holds DSP
  kernels ported to Rust, so far the Compressor. Each port is tested against
  the JavaScript kernel's own output (below). Nothing plays through it yet.

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
  `sudo apt install libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev build-essential`.

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

- `Cargo.toml`: the Rust workspace (the engine and the app).
- `src-tauri/`: the app.
  - `tauri.conf.json`: the window (opening the studio at `/app`), the site
    it serves (`out/`, built by `npm run build` before each app build), and
    the bundle (name, icons, macOS entitlements). Its version is
    `package.json`'s.
  - `src/lib.rs`: starts the app; lets the studio's own pages use the
    microphone and MIDI without the webview asking on every launch; and the
    commands the studio can call (`engine_info` for now).
  - `capabilities/default.json`: what the window may use of Tauri's own API.
  - `Info.plist`, `Entitlements.plist`: macOS's microphone prompt text and
    permission.
  - `icons/`: made from `public/icons/icon-512.png`. To remake them from a
    new image: `npx @tauri-apps/cli@2 icon path/to/icon.png`.
- `crates/dawn-engine/`: the native engine.
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

`crates/dawn-engine` is plain Rust with no dependencies. Each kernel is a
port of a JavaScript one from `src/effects/` and computes the same thing
step for step: the same `f64` state and `f32` buffers as the JavaScript's
numbers and Float32Arrays, the arithmetic in the same order. The rules for
`process`, which will run on the audio thread: no allocation, locks, I/O or
panics.

### Parity tests

A kernel's parity test proves the port renders what the JavaScript renders:

1. `src/effects/<effect>/<effect>Parity.ts` defines cases (parameters,
   which inputs and sidechain are connected, a settings change midway) and
   renders them with the JavaScript kernel the way its worklet runs it
   (128-frame blocks, meters read every 512 frames).
2. That's stored as a fixture in `crates/dawn-engine/tests/fixtures/`: a
   generated Rust file with the cases and the settings the JavaScript made
   of their parameters, and a binary file with the rendered samples and
   meters.
3. `npm test` checks the fixture is still what the JavaScript kernel
   renders, so a change to the kernel fails until the fixture is remade:
   `UPDATE_ENGINE_FIXTURES=1 npx vitest run --project unit <effect>Parity`.
4. `cargo test -p dawn-engine` renders the same cases with the Rust kernel
   and compares, sample by sample, to within -100 dB. (The Compressor
   matches exactly; only its meters differ, by around 1e-14.)

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

## Next steps

1. **Port the rest of the DSP**: the remaining worklet kernels (gate, glue,
   limiter, the multiband effects, EQ, utility, pitch shift, the Furnace
   amp, the synth and drum rack, the metronome), then what's built from
   Web Audio nodes today (chorus, delay, EQ Three, filter, reverb, the IR
   loader, saturator, tuner, the piano sampler). NAM's engine is C++
   (NeuralAmpModelerCore) and can be built into the native engine as is.
2. **Play through the engine**: audio devices with
   [cpal](https://github.com/RustAudio/cpal) (ASIO on Windows with its
   `asio` feature and Steinberg's ASIO SDK license), a mixer and a
   transport, and a native engine for the studio behind `EngineApi` in
   `src/engine/engineSync.ts`, so the studio drives either engine.
3. **Recording, export and files**: input streams written to disk, offline
   rendering, native file dialogs.
4. **Plugins**: scanning, hosting and showing installed VST3 and CLAP
   plugins in their own windows.

## Checks

Every push tests the engine (the `engine` job in
`.github/workflows/ci.yml`). `.github/workflows/desktop.yml` builds the app
on Windows, macOS and Linux whenever `src-tauri/`, `crates/` or the
workspace's `Cargo.toml` changes, or when run by hand from the Actions tab.
`.github/workflows/installers.yml` makes the installers on every push to
`main` (above).
