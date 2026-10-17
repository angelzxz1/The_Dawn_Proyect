//! The effects' DSP kernels, one module each, named like the web app's
//! effect folders (`src/effects/<name>/`).

pub mod compressor;
pub mod limiter;
pub mod sidechain;

/// The effect types (their saved keys) whose kernels have been ported.
pub const PORTED: &[&str] = &["compressor", "limiter"];
