//! The effects' DSP kernels, one module each, named like the web app's
//! effect folders (`src/effects/<name>/`).

pub mod amp;
pub mod biquad_node;
pub mod chorus;
pub mod compressor;
pub mod convolver;
pub mod delay;
pub mod delay_node;
pub mod eq_three;
pub mod filter;
pub mod gate;
pub mod glue;
pub mod ir_loader;
pub mod limiter;
pub mod mb_dynamics;
pub mod multiband;
pub mod param_eq;
pub mod pitch_shift;
pub mod reverb;
pub mod saturator;
pub mod sidechain;
pub mod tone_lfo;
pub mod tuner;
pub mod utility;
pub mod wave_shaper;

/// The effect types (their saved keys) whose kernels have been ported.
pub const PORTED: &[&str] = &[
    "chorus",
    "compressor",
    "delay",
    "distortion",
    "eq3",
    "filter",
    "gate",
    "glue",
    "irLoader",
    "limiter",
    "mbDynamics",
    "multiband",
    "paramEq",
    "pitchShift",
    "reverb",
    "tubeAmp",
    "tuner",
    "utility",
];
