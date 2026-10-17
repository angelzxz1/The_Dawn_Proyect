//! A small plugin for testing Dawn's plugin hosting (crates/dawn-plugins)
//! against: one library that's both a CLAP plugin file and a VST3 module,
//! each with two plugins in it, "Dawn Test Gain" (an effect) and "Dawn Test
//! Tone" (an instrument).
//!
//! It also misbehaves on purpose, for the scanner's tests: as a CLAP file
//! whose name has "Crashes" in it, it crashes as it's loaded, and with
//! "Hangs", it never finishes loading.

mod clap;
mod vst3;

pub(crate) const VENDOR: &str = "The Dawn Project";
pub(crate) const VERSION: &str = "1.0.0";
pub(crate) const GAIN_NAME: &str = "Dawn Test Gain";
pub(crate) const TONE_NAME: &str = "Dawn Test Tone";
