//! The Furnace amp port against the JavaScript kernel: renders the cases in
//! the fixture (made by src/effects/furnace/ampParity.test.ts) the way the
//! worklet runs the kernel, on the mono mix of the input, and compares the
//! samples with what the JavaScript rendered.

mod common;

use common::{FixtureReader, Signal};
use dawn_engine::effects::amp::{AmpEffect, AmpKernel, AmpSettings};

/// -100 dB, well under anything audible (the run prints the largest
/// difference per case).
const TOLERANCE: f64 = 1e-5;

type Params = &'static [(&'static str, f64)];

struct Case {
    name: &'static str,
    params: Params,
    /// New parameters from this frame on.
    change: Option<(usize, Params)>,
}

include!("fixtures/amp.rs");

const DATA: &[u8] = include_bytes!("fixtures/amp.bin");

/// The node's one input channel: the stereo input down-mixed.
fn mono(sig: &Signal) -> Vec<f32> {
    sig.in_l
        .iter()
        .zip(&sig.in_r)
        .map(|(l, r)| 0.5 * (l + r))
        .collect()
}

#[test]
fn renders_what_the_javascript_kernel_renders() {
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    assert_eq!(sig.hash(), SIGNAL_HASH, "the test signals differ");
    let input = mono(&sig);
    let mut data = FixtureReader::new(DATA);
    for case in CASES {
        let mut k = AmpKernel::new(SAMPLE_RATE, &AmpSettings::from_params(case.params));
        let mut out = vec![0.0f32; FRAMES];
        for start in (0..FRAMES).step_by(BLOCK) {
            if let Some((_, params)) = case.change.filter(|(at, _)| *at == start) {
                k.set(&AmpSettings::from_params(params));
            }
            let end = (start + BLOCK).min(FRAMES);
            k.process(Some(&input[start..end]), &mut out[start..end]);
        }
        let mut worst = 0.0f64;
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
        println!("{}: largest difference {worst:e}", case.name);
    }
    assert!(data.is_empty(), "the fixture has more data than the cases");
}

#[test]
fn the_effect_plays_the_inputs_mix_on_both_sides() {
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    let s = AmpSettings::default();
    let mut k = AmpKernel::new(SAMPLE_RATE, &s);
    let input = mono(&sig);
    let mut expected = vec![0.0f32; 8192];
    k.process(Some(&input[..8192]), &mut expected);
    let mut fx = AmpEffect::new(SAMPLE_RATE, &s);
    let (mut l, mut r) = (sig.in_l[..8192].to_vec(), sig.in_r[..8192].to_vec());
    fx.process_in_place(&mut l, &mut r);
    assert_eq!(l, expected);
    assert_eq!(r, expected);
}
