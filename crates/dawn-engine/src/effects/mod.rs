//! The effects' DSP kernels, one module each, named like the web app's
//! effect folders (`src/effects/<name>/`).

pub mod compressor;
pub mod gate;
pub mod glue;
pub mod limiter;
pub mod mb_dynamics;
pub mod multiband;
pub mod param_eq;
pub mod sidechain;
pub mod utility;

/// The effect types (their saved keys) whose kernels have been ported.
pub const PORTED: &[&str] = &[
    "compressor",
    "gate",
    "glue",
    "limiter",
    "mbDynamics",
    "multiband",
    "paramEq",
    "utility",
];
