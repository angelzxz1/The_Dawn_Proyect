//! The Utility port against the JavaScript kernel: renders the cases in the
//! fixture (made by src/effects/utility/utilityParity.test.ts) the way the
//! worklet runs the kernel, and compares samples and meters with what the
//! JavaScript rendered.

mod common;

use common::{FixtureReader, Signal};
use dawn_engine::effects::utility::{UtilityKernel, UtilitySettings};

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

include!("fixtures/utility.rs");

const DATA: &[u8] = include_bytes!("fixtures/utility.bin");

#[test]
fn renders_what_the_javascript_kernel_renders() {
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    assert_eq!(sig.hash(), SIGNAL_HASH, "the test signals differ");
    let mut data = FixtureReader::new(DATA);
    for case in CASES {
        let mut k = UtilityKernel::new(SAMPLE_RATE, &UtilitySettings::from_params(case.params));
        let mut out_l = vec![0.0f32; FRAMES];
        let mut out_r = vec![0.0f32; FRAMES];
        let mut meters = vec![];
        let mut count = 0;
        for start in (0..FRAMES).step_by(BLOCK) {
            if let Some((_, params)) = case.change.filter(|(at, _)| *at == start) {
                k.set(&UtilitySettings::from_params(params));
            }
            let end = (start + BLOCK).min(FRAMES);
            let in_r = (!case.mono).then(|| &sig.in_r[start..end]);
            k.process(
                Some(&sig.in_l[start..end]),
                in_r,
                &mut out_l[start..end],
                Some(&mut out_r[start..end]),
            );
            count += end - start;
            if count >= METER_INTERVAL {
                count = 0;
                meters.push(k.take_meters());
            }
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
        for (i, m) in meters.iter().enumerate() {
            for (what, ours) in [
                ("left peak", m.peak_l),
                ("right peak", m.peak_r),
                ("correlation", m.correlation),
            ] {
                let theirs = data.f64();
                assert!(
                    (ours - theirs).abs() <= TOLERANCE,
                    "{}: reading {i}'s {what}: {ours} where the JavaScript has {theirs}",
                    case.name
                );
            }
        }
        println!("{}: largest difference {worst:e}", case.name);
    }
    assert!(data.is_empty(), "the fixture has more data than the cases");
}

#[test]
fn processing_in_place_is_processing_into_another_buffer() {
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    let s = UtilitySettings::from_params(&[("width", 2.0), ("bassMono", 1.0), ("gain", -2.0)]);
    let (mut a, mut b) = (
        UtilityKernel::new(SAMPLE_RATE, &s),
        UtilityKernel::new(SAMPLE_RATE, &s),
    );
    let (mut l, mut r) = (vec![0.0; 4096], vec![0.0; 4096]);
    a.process(
        Some(&sig.in_l[..4096]),
        Some(&sig.in_r[..4096]),
        &mut l,
        Some(&mut r),
    );
    let (mut il, mut ir) = (sig.in_l[..4096].to_vec(), sig.in_r[..4096].to_vec());
    b.process_in_place(&mut il, &mut ir);
    assert_eq!(l, il);
    assert_eq!(r, ir);
}
