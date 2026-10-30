//! The Saturator port against Chromium: renders the cases in the fixture
//! (made by src/effects/saturator/saturatorParity.webaudio.test.ts, through
//! the studio's own nodes) in 128-frame blocks, as the browser does, and
//! compares the samples.

mod common;

use common::{FixtureReader, Signal};
use dawn_engine::effects::saturator::{SaturatorKernel, SaturatorSettings};

/// -120 dB, without oversampling. That port is exact (the run prints the
/// largest difference per case).
const TOLERANCE: f64 = 1e-6;

/// -46 dB, with oversampling. The browser this is rendered in (Chrome
/// 141) runs its 2x downsampler as an FFT convolution, which rounds
/// differently from the direct one ported here (as Chromium now runs it),
/// so the shaped signal is a float32 rounding or so off. The DC blocker
/// after it (a 10 Hz high pass) works in float32 with its poles right by
/// DC, so it turns those roundings into a slow drift of a few 1e-4 (more
/// after the Output gain), in Chromium too: its own output moves that
/// much with the last bits of its input. Anything wrong in the port
/// (a tap, the timing) is far over this.
const OVERSAMPLED_TOLERANCE: f64 = 5e-3;

const BLOCK: usize = 128;

type Params = &'static [(&'static str, f64)];

struct Case {
    name: &'static str,
    params: Params,
    /// New parameters from this frame on.
    change: Option<(usize, Params)>,
}

include!("fixtures/saturator.rs");

const DATA: &[u8] = include_bytes!("fixtures/saturator.bin");

fn oversampled(params: Params) -> bool {
    // The default is 2x.
    params
        .iter()
        .find(|(k, _)| *k == "oversample")
        .is_none_or(|(_, v)| v.round() != 0.0)
}

#[test]
fn renders_what_chromium_renders() {
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    assert_eq!(sig.hash(), SIGNAL_HASH, "the test signals differ");
    let mut data = FixtureReader::new(DATA);
    for case in CASES {
        let tolerance =
            if oversampled(case.params) || case.change.is_some_and(|(_, p)| oversampled(p)) {
                OVERSAMPLED_TOLERANCE
            } else {
                TOLERANCE
            };
        let mut k = SaturatorKernel::new(SAMPLE_RATE, &SaturatorSettings::from_params(case.params));
        let mut l = sig.in_l.clone();
        let mut r = sig.in_r.clone();
        for start in (0..FRAMES).step_by(BLOCK) {
            if let Some((_, params)) = case.change.filter(|(at, _)| *at == start) {
                k.set(&SaturatorSettings::from_params(params));
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
                    d <= tolerance,
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
