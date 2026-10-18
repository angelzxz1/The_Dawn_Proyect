//! The Multiband Dynamics port against the JavaScript kernel: renders the
//! cases in the fixture (made by
//! src/effects/multiband-dynamics/mbDynamicsParity.test.ts) the way the
//! worklet runs the kernel, and compares samples and meters with what the
//! JavaScript rendered.

mod common;

use common::{FixtureReader, Signal};
use dawn_engine::effects::mb_dynamics::{MbDynamicsKernel, MbDynamicsSettings};

/// -100 dB, well under anything audible (the run prints the largest
/// difference per case).
const TOLERANCE: f64 = 1e-5;

type Params = &'static [(&'static str, f64)];

/// Which channels of a stream are connected.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Channels {
    None,
    Mono,
    Stereo,
}

struct Case {
    name: &'static str,
    params: Params,
    external: bool,
    input: Channels,
    key: Channels,
    /// New parameters from this frame on.
    change: Option<(usize, Params)>,
}

include!("fixtures/mb_dynamics.rs");

const DATA: &[u8] = include_bytes!("fixtures/mb_dynamics.bin");

#[test]
fn renders_what_the_javascript_kernel_renders() {
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    assert_eq!(sig.hash(), SIGNAL_HASH, "the test signals differ");
    let mut data = FixtureReader::new(DATA);
    for case in CASES {
        let mut k = MbDynamicsKernel::new(
            SAMPLE_RATE,
            &MbDynamicsSettings::from_params(case.params, case.external),
        );
        let mut out_l = vec![0.0f32; FRAMES];
        let mut out_r = vec![0.0f32; FRAMES];
        let mut meters = vec![];
        let mut count = 0;
        for start in (0..FRAMES).step_by(BLOCK) {
            if let Some((_, params)) = case.change.filter(|(at, _)| *at == start) {
                k.set(&MbDynamicsSettings::from_params(params, case.external));
            }
            let end = (start + BLOCK).min(FRAMES);
            let in_r = (case.input == Channels::Stereo).then(|| &sig.in_r[start..end]);
            let key_l = (case.key != Channels::None).then(|| &sig.key_l[start..end]);
            let key_r = (case.key == Channels::Stereo).then(|| &sig.key_r[start..end]);
            k.process(
                Some(&sig.in_l[start..end]),
                in_r,
                key_l,
                key_r,
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
            for (b, band) in m.iter().enumerate() {
                let ours = band.map_or([-1.0, -1.0], |m| [m.input, m.output]);
                for (what, ours) in ["input", "output"].iter().zip(ours) {
                    let theirs = data.f64();
                    assert!(
                        (ours - theirs).abs() <= TOLERANCE,
                        "{}: reading {i}'s band {b} {what}: {ours} where the JavaScript has {theirs}",
                        case.name
                    );
                }
            }
        }
        println!("{}: largest difference {worst:e}", case.name);
    }
    assert!(data.is_empty(), "the fixture has more data than the cases");
}

#[test]
fn processing_in_place_is_processing_a_quantum_at_a_time() {
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    let s = MbDynamicsSettings::from_params(&[("mAboveT", -30.0), ("mAboveR", 4.0)], false);
    let (mut a, mut b) = (
        MbDynamicsKernel::new(SAMPLE_RATE, &s),
        MbDynamicsKernel::new(SAMPLE_RATE, &s),
    );
    let moved = MbDynamicsSettings::from_params(
        &[("mAboveT", -30.0), ("mAboveR", 4.0), ("xHigh", 6000.0)],
        false,
    );
    a.set(&moved);
    b.set(&moved);
    let (mut l, mut r) = (vec![0.0; 8192], vec![0.0; 8192]);
    for start in (0..8192).step_by(128) {
        let end = start + 128;
        a.process(
            Some(&sig.in_l[start..end]),
            Some(&sig.in_r[start..end]),
            None,
            None,
            &mut l[start..end],
            Some(&mut r[start..end]),
        );
    }
    let (mut il, mut ir) = (sig.in_l[..8192].to_vec(), sig.in_r[..8192].to_vec());
    b.process_in_place(&mut il, &mut ir);
    assert_eq!((l, r), (il, ir));
}

#[test]
fn the_meters_name_the_bands_that_exist() {
    let s = MbDynamicsSettings::from_params(&[("lowOn", 0.0)], false);
    let mut k = MbDynamicsKernel::new(SAMPLE_RATE, &s);
    let (mut l, mut r) = (vec![0.5; 128], vec![0.5; 128]);
    k.process_in_place(&mut l, &mut r);
    let m = k.take_meters();
    assert!(m[0].is_none());
    assert!(m[1].is_some_and(|b| b.input > 0.0) && m[2].is_some());
    assert_eq!(k.take_meters()[1].map(|b| b.input), Some(0.0));
}
