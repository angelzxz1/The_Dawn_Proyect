//! The Noise Gate port against the JavaScript kernel: renders the cases in
//! the fixture (made by src/effects/gate/gateParity.test.ts) the way the
//! worklet runs the kernel, and compares samples and meters with what the
//! JavaScript rendered.

mod common;

use common::{FixtureReader, Signal};
use dawn_engine::effects::gate::{GateKernel, GateSettings};

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

include!("fixtures/gate.rs");

const DATA: &[u8] = include_bytes!("fixtures/gate.bin");

#[test]
fn renders_what_the_javascript_kernel_renders() {
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    assert_eq!(sig.hash(), SIGNAL_HASH, "the test signals differ");
    let mut data = FixtureReader::new(DATA);
    for case in CASES {
        let mut k = GateKernel::new(
            SAMPLE_RATE,
            &GateSettings::from_params(case.params, case.external),
        );
        let mut out_l = vec![0.0f32; FRAMES];
        let mut out_r = vec![0.0f32; FRAMES];
        let mut meters = vec![];
        let (mut peak, mut min_gain, mut count) = (0.0f64, 1.0f64, 0);
        for start in (0..FRAMES).step_by(BLOCK) {
            if let Some((_, params)) = case.change.filter(|(at, _)| *at == start) {
                k.set(&GateSettings::from_params(params, case.external));
            }
            let end = (start + BLOCK).min(FRAMES);
            let in_r = (case.input == Channels::Stereo).then(|| &sig.in_r[start..end]);
            let key_l = (case.key != Channels::None).then(|| &sig.key_l[start..end]);
            let key_r = (case.key == Channels::Stereo).then(|| &sig.key_r[start..end]);
            let r = k.process(
                Some(&sig.in_l[start..end]),
                in_r,
                &mut out_l[start..end],
                Some(&mut out_r[start..end]),
                key_l,
                key_r,
            );
            peak = peak.max(r.peak_in);
            min_gain = min_gain.min(r.min_gain);
            count += end - start;
            if count >= METER_INTERVAL {
                meters.push((peak, min_gain, k.is_open()));
                (peak, min_gain, count) = (0.0, 1.0, 0);
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
        for (i, (peak, gain, open)) in meters.iter().enumerate() {
            for (what, ours) in [("key peak", *peak), ("lowest gain", *gain)] {
                let theirs = data.f64();
                assert!(
                    (ours - theirs).abs() <= TOLERANCE,
                    "{}: reading {i}'s {what}: {ours} where the JavaScript has {theirs}",
                    case.name
                );
            }
            assert_eq!(*open, data.f64() == 1.0, "{}: reading {i}: open", case.name);
        }
        println!("{}: largest difference {worst:e}", case.name);
    }
    assert!(data.is_empty(), "the fixture has more data than the cases");
}

#[test]
fn processing_in_place_is_processing_keyed_by_its_input() {
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    let s = GateSettings::from_params(&[("threshold", -20.0), ("scHpf", 200.0)], false);
    let (mut a, mut b) = (
        GateKernel::new(SAMPLE_RATE, &s),
        GateKernel::new(SAMPLE_RATE, &s),
    );
    let (mut l, mut r) = (vec![0.0; 8192], vec![0.0; 8192]);
    let ra = a.process(
        Some(&sig.in_l[..8192]),
        Some(&sig.in_r[..8192]),
        &mut l,
        Some(&mut r),
        None,
        None,
    );
    let (mut il, mut ir) = (sig.in_l[..8192].to_vec(), sig.in_r[..8192].to_vec());
    let rb = b.process_in_place(&mut il, &mut ir);
    assert_eq!((l, r), (il, ir));
    assert_eq!(ra, rb);
}
