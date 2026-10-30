//! The Filter port against Chromium: renders the cases in the fixture (made
//! by src/effects/filter/filterParity.webaudio.test.ts, through the
//! studio's own nodes) in 128-frame blocks, as the browser does, and
//! compares the samples.

mod common;

use common::{FixtureReader, Signal};
use dawn_engine::effects::filter::{FilterKernel, FilterSettings};

/// -100 dB. Without the LFO the port is exact; Chromium's LFO reads a wave
/// table, so with it the two differ by a few millionths (the run prints
/// the largest difference per case).
const TOLERANCE: f64 = 1e-5;

const BLOCK: usize = 128;

type Params = &'static [(&'static str, f64)];

struct Case {
    name: &'static str,
    params: Params,
    /// New parameters from this frame on.
    change: Option<(usize, Params)>,
}

include!("fixtures/filter.rs");

const DATA: &[u8] = include_bytes!("fixtures/filter.bin");

#[test]
fn renders_what_chromium_renders() {
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    assert_eq!(sig.hash(), SIGNAL_HASH, "the test signals differ");
    let mut data = FixtureReader::new(DATA);
    for case in CASES {
        let mut k = FilterKernel::new(SAMPLE_RATE, &FilterSettings::from_params(case.params));
        let mut l = sig.in_l.clone();
        let mut r = sig.in_r.clone();
        for start in (0..FRAMES).step_by(BLOCK) {
            if let Some((_, params)) = case.change.filter(|(at, _)| *at == start) {
                k.set(&FilterSettings::from_params(params));
            }
            let end = (start + BLOCK).min(FRAMES);
            k.process_in_place(&mut l[start..end], &mut r[start..end]);
        }
        let mut worst = 0.0f64;
        for out in [&l, &r] {
            for (j, x) in out.iter().enumerate().step_by(STRIDE) {
                let expected = data.f32();
                let d = (*x as f64 - expected as f64).abs();
                assert!(
                    d <= TOLERANCE,
                    "{}: frame {j}: {x} where Chromium has {expected}",
                    case.name
                );
                worst = worst.max(d);
            }
        }
        println!("{}: largest difference {worst:e}", case.name);
    }
    assert!(data.is_empty(), "the fixture has more data than the cases");
}
