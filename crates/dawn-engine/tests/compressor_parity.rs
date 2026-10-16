//! The Compressor port against the JavaScript kernel: renders the cases in
//! the fixture (made by src/effects/compressor/compressorParity.test.ts) the
//! way the worklet runs the kernel, and compares samples and meters with
//! what the JavaScript rendered.

mod common;

use common::{FixtureReader, Signal};
use dawn_engine::effects::compressor::{CompressorKernel, CompressorMeters, CompressorSettings};
use dawn_engine::effects::sidechain::KeySettings;

/// The furthest a sample or meter may be from the JavaScript's: -100 dB,
/// well under anything audible. In practice the two agree to the last bit
/// or two of an f32 (the run prints the largest difference per case).
const TOLERANCE: f64 = 1e-5;

/// Which channels of a stream are connected.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Channels {
    None,
    Mono,
    Stereo,
}

struct Change {
    /// A block start.
    at: usize,
    params: &'static [(&'static str, f64)],
    settings: CompressorSettings,
}

struct Case {
    name: &'static str,
    params: &'static [(&'static str, f64)],
    external: bool,
    input: Channels,
    key: Channels,
    /// What the JavaScript's compressorSettingsFromParams made of `params`.
    settings: CompressorSettings,
    change: Option<Change>,
}

include!("fixtures/compressor.rs");

const DATA: &[u8] = include_bytes!("fixtures/compressor.bin");

#[test]
fn settings_from_params_match_the_javascript() {
    for case in CASES {
        assert_eq!(
            CompressorSettings::from_params(case.params, case.external),
            case.settings,
            "{}",
            case.name
        );
        if let Some(change) = &case.change {
            assert_eq!(
                CompressorSettings::from_params(change.params, case.external),
                change.settings,
                "{} (after the change)",
                case.name
            );
        }
    }
}

/// Renders a case as the worklet would: blocks of BLOCK frames, meters read
/// every METER_INTERVAL frames.
fn render(case: &Case, sig: &Signal) -> (Vec<f32>, Vec<f32>, Vec<CompressorMeters>) {
    let mut kernel = CompressorKernel::new(SAMPLE_RATE, &case.settings);
    let mut out_l = vec![0.0f32; FRAMES];
    let mut out_r = vec![0.0f32; FRAMES];
    let mut meters = Vec::new();
    let mut count = 0;
    for start in (0..FRAMES).step_by(BLOCK) {
        if let Some(change) = case.change.as_ref().filter(|c| c.at == start) {
            kernel.set(&change.settings);
        }
        let range = start..(start + BLOCK).min(FRAMES);
        let n = range.len();
        kernel.process(
            Some(&sig.in_l[range.clone()]),
            (case.input == Channels::Stereo).then(|| &sig.in_r[range.clone()]),
            (case.key != Channels::None).then(|| &sig.key_l[range.clone()]),
            (case.key == Channels::Stereo).then(|| &sig.key_r[range.clone()]),
            &mut out_l[range.clone()],
            Some(&mut out_r[range]),
        );
        count += n;
        if count >= METER_INTERVAL {
            count = 0;
            meters.push(kernel.take_meters());
        }
    }
    (out_l, out_r, meters)
}

#[test]
fn renders_what_the_javascript_kernel_renders() {
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    assert_eq!(
        sig.hash(),
        SIGNAL_HASH,
        "the test signal isn't the JavaScript's: tests/common/mod.rs and src/test/kernelParity.ts must build it the same way"
    );
    let mut data = FixtureReader::new(DATA);
    for case in CASES {
        let (out_l, out_r, meters) = render(case, &sig);
        let mut worst_sample = 0.0f64;
        for out in [&out_l, &out_r] {
            for i in (0..FRAMES).step_by(STRIDE) {
                let d = f64::from((out[i] - data.f32()).abs());
                worst_sample = worst_sample.max(d);
            }
        }
        let mut worst_meter = 0.0f64;
        for m in &meters {
            for value in [m.input, m.output, m.key, m.gain_reduction] {
                worst_meter = worst_meter.max((value - data.f64()).abs());
            }
        }
        eprintln!(
            "{:<28} largest difference: samples {worst_sample:.1e}, meters {worst_meter:.1e}",
            case.name
        );
        assert!(
            worst_sample <= TOLERANCE && worst_meter <= TOLERANCE,
            "{}: the port is off by up to {:.1e} in the samples and {:.1e} in the meters",
            case.name,
            worst_sample,
            worst_meter
        );
    }
    assert!(
        data.is_empty(),
        "the fixture has more data than its cases: remake it"
    );
}

#[test]
fn the_cases_compress() {
    // A fixture that rendered silence or passed audio through untouched
    // would prove little: the cases that compress must actually reduce gain.
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    for case in CASES
        .iter()
        .filter(|c| c.key != Channels::None || !c.external)
    {
        let (_, _, meters) = render(case, &sig);
        let most = meters.iter().map(|m| m.gain_reduction).fold(0.0, f64::min);
        assert!(
            most < -3.0,
            "{}: at most {most:.1} dB of gain reduction",
            case.name
        );
    }
}
