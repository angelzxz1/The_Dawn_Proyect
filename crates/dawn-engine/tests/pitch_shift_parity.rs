//! The Pitch Shift port against the worklet's processor: renders the cases
//! in the fixture (made by src/effects/pitch-shift/pitchShiftParity.test.ts)
//! a render quantum at a time, with the parameters as the AudioParams hold
//! them, and compares the samples with what the JavaScript rendered. Then
//! the node around it: the dry path and the Dry/Wet blend.

mod common;

use common::{FixtureReader, Signal};
use dawn_engine::effects::pitch_shift::{
    PitchShiftKernel, PitchShiftSettings, PitchShifter, ShifterParams,
};

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

include!("fixtures/pitch_shift.rs");

const DATA: &[u8] = include_bytes!("fixtures/pitch_shift.bin");

#[test]
fn renders_what_the_javascript_processor_renders() {
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    assert_eq!(sig.hash(), SIGNAL_HASH, "the test signals differ");
    let mut data = FixtureReader::new(DATA);
    for case in CASES {
        let mut k = PitchShiftKernel::new(SAMPLE_RATE);
        let mut s = PitchShiftSettings::from_params(case.params);
        let mut out_l = vec![0.0f32; FRAMES];
        let mut out_r = vec![0.0f32; FRAMES];
        for start in (0..FRAMES).step_by(BLOCK) {
            if let Some((_, p)) = case.change.filter(|(at, _)| *at == start) {
                s = PitchShiftSettings::from_params(p);
            }
            let end = (start + BLOCK).min(FRAMES);
            k.process(
                Some(&sig.in_l[start..end]),
                Some(&sig.in_r[start..end]),
                &mut out_l[start..end],
                &mut out_r[start..end],
                ShifterParams::new(&s),
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
fn in_place_is_the_same() {
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    let s = PitchShiftSettings::from_params(&[("pitch", 7.0), ("feedback", 0.4)]);
    let p = ShifterParams::new(&s);
    let (mut a, mut b) = (
        PitchShiftKernel::new(SAMPLE_RATE),
        PitchShiftKernel::new(SAMPLE_RATE),
    );
    let (mut l, mut r) = (vec![0.0; 8192], vec![0.0; 8192]);
    a.process(
        Some(&sig.in_l[..8192]),
        Some(&sig.in_r[..8192]),
        &mut l,
        &mut r,
        p,
    );
    let (mut il, mut ir) = (sig.in_l[..8192].to_vec(), sig.in_r[..8192].to_vec());
    b.process_in_place(&mut il, &mut ir, p);
    assert_eq!((l, r), (il, ir));
}

#[test]
fn dry_the_node_plays_its_input_as_late_as_the_shifted_signal() {
    let s = PitchShiftSettings::from_params(&[("pitch", 7.0), ("wet", 0.0)]);
    let mut node = PitchShifter::new(SAMPLE_RATE, &s);
    // 0.1 s window: half of it, and 2 samples.
    assert_eq!(node.latency(), 2402);
    let mut l = vec![0.0; 4096];
    l[10] = 1.0;
    let mut r = l.clone();
    node.process_in_place(&mut l, &mut r);
    let hits: Vec<usize> = (0..l.len()).filter(|&i| l[i].abs() > 1e-4).collect();
    assert_eq!(hits, [10 + 2402]);
    assert!((l[2412] - 1.0).abs() < 1e-4 && l == r);
}

#[test]
fn at_unison_wet_is_the_input_as_late_and_the_blend_is_equal_power() {
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    let render = |wet: f64| {
        let s = PitchShiftSettings::from_params(&[("wet", wet)]);
        let mut node = PitchShifter::new(SAMPLE_RATE, &s);
        let (mut l, mut r) = (sig.in_l[..9600].to_vec(), sig.in_r[..9600].to_vec());
        node.process_in_place(&mut l, &mut r);
        l
    };
    // Ratio 1: one tap holds the delay steady at half the window (the
    // window a float32, so a hair over: within 1e-3 of the dry path, where
    // a frame off would be far more).
    let (dry, wet, half) = (render(0.0), render(1.0), render(0.5));
    let worst = |a: &[f32], b: &[f32]| {
        (2403..9599)
            .map(|i| (a[i] - b[i]).abs())
            .fold(0.0f32, f32::max)
    };
    assert!(worst(&wet, &dry) < 1e-3, "{}", worst(&wet, &dry));
    assert!(worst(&wet[1..], &dry) > 0.05);
    let blend: Vec<f32> = (0..9600)
        .map(|i| (dry[i] + wet[i]) * std::f32::consts::FRAC_1_SQRT_2)
        .collect();
    assert!(worst(&half, &blend) < 1e-5, "{}", worst(&half, &blend));
}
