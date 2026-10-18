//! The Parametric EQ port against the JavaScript kernel: renders the cases
//! in the fixture (made by src/effects/parametric-eq/paramEqParity.test.ts)
//! the way the worklet runs the kernel, and compares the samples with what
//! the JavaScript rendered.

mod common;

use common::{FixtureReader, Signal};
use dawn_engine::effects::param_eq::{ParamEqKernel, ParamEqSettings, default_band_freq};

/// -100 dB, well under anything audible (the run prints the largest
/// difference per case).
const TOLERANCE: f64 = 1e-5;

type Params = &'static [(&'static str, f64)];

struct Case {
    name: &'static str,
    params: Params,
    mono: bool,
    /// New parameters from this frame on.
    change: Option<(usize, Params)>,
}

include!("fixtures/param_eq.rs");

const DATA: &[u8] = include_bytes!("fixtures/param_eq.bin");

#[test]
fn renders_what_the_javascript_kernel_renders() {
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    assert_eq!(sig.hash(), SIGNAL_HASH, "the test signals differ");
    let mut data = FixtureReader::new(DATA);
    for case in CASES {
        let mut k = ParamEqKernel::new(SAMPLE_RATE, &ParamEqSettings::from_params(case.params));
        let mut out_l = vec![0.0f32; FRAMES];
        let mut out_r = vec![0.0f32; FRAMES];
        for start in (0..FRAMES).step_by(BLOCK) {
            if let Some((_, params)) = case.change.filter(|(at, _)| *at == start) {
                k.set(&ParamEqSettings::from_params(params));
            }
            let end = (start + BLOCK).min(FRAMES);
            let in_r = (!case.mono).then(|| &sig.in_r[start..end]);
            k.process(
                Some(&sig.in_l[start..end]),
                in_r,
                &mut out_l[start..end],
                Some(&mut out_r[start..end]),
            );
        }
        let mut worst = 0.0f64;
        for out in [&out_l, &out_r] {
            for (j, x) in out.iter().enumerate().step_by(STRIDE) {
                let expected = data.f32();
                let d = (*x as f64 - expected as f64).abs();
                assert!(
                    d <= TOLERANCE,
                    "{}: frame {j}: {x} where the JavaScript has {expected}",
                    case.name
                );
                worst = worst.max(d);
            }
        }
        println!("{}: largest difference {worst:e}", case.name);
    }
    assert!(data.is_empty(), "the fixture has more data than the cases");
}

#[test]
fn new_bands_spread_across_the_spectrum_as_in_the_studio() {
    // paramEqModel.ts's defaultBandFreq.
    assert_eq!(default_band_freq(0), 40.0);
    assert_eq!(default_band_freq(23), 15792.2);
}
