//! The instruments' DSP, ported from the web app's (`src/instruments/`):
//! the Drum Rack's and the synth's kernels step for step, so each plays
//! what its AudioWorklet plays (their parity tests check it), and the
//! piano, a sampler that plays like Tone.js's.
//!
//! Each takes notes as timestamped events, in seconds on its own clock,
//! and starts them on their exact sample; the engine (`mix::engine`) makes
//! the events from the MIDI clips and from notes played live.

pub mod drums;
pub mod piano;
pub mod synth;

/// JavaScript's `Math.round`: halves round up, toward +∞ (Rust's `round`
/// rounds them away from zero).
pub(crate) fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// tanh, close enough for saturation and much cheaper (the kernels' `sat`).
pub(crate) fn sat(x: f64) -> f64 {
    if x < -3.0 {
        return -1.0;
    }
    if x > 3.0 {
        return 1.0;
    }
    let x2 = x * x;
    (x * (27.0 + x2)) / (27.0 + 9.0 * x2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounds_halves_as_javascript_does() {
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(-0.4), 0.0);
        assert_eq!(js_round(7.0), 7.0);
    }
}
