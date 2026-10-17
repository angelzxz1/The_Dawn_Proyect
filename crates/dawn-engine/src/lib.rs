//! Dawn's native audio engine.
//!
//! `mix` plays the song: the transport, the clips, the mix, the master and
//! the metronome, rendered for an audio interface or a file. `effects`
//! holds the DSP kernels, ported one by one from the web app's AudioWorklets
//! (`src/effects/*/…Model.ts`). Each port computes exactly
//! what the JavaScript kernel computes, step for step, and its parity test
//! (`tests/`) checks it against output the JavaScript kernel rendered (see
//! docs/desktop.md). That keeps one sound across the browser and the
//! desktop app while the engine moves over.
//!
//! The rules for kernels, since `process` runs on the audio thread:
//! no allocation, no locks, no I/O and no panics in `process`; settings
//! arrive between blocks through `set`.

pub mod effects;
pub mod mix;
pub mod params;

/// This crate's version.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
