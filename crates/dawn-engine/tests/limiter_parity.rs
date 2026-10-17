//! The Limiter port against the JavaScript processor: renders the cases in
//! the fixture (made by src/effects/limiter/limiterParity.test.ts) the way
//! the worklet runs, and compares samples and meters with what the
//! JavaScript rendered.

mod common;

use common::{FixtureReader, Signal};
use dawn_engine::effects::limiter::{
    LOOKAHEAD, Limiter, LimiterMeters, LimiterSettings, METER_INTERVAL,
};

/// -100 dB, well under anything audible (the run prints the largest
/// difference per case).
const TOLERANCE: f64 = 1e-5;

struct Case {
    name: &'static str,
    /// The ceiling and gain the settings came from (dB).
    db: (f64, f64),
    /// What the processor's parameters were (float32 AudioParams).
    settings: LimiterSettings,
    mono: bool,
    /// New settings from this frame on.
    change: Option<(usize, LimiterSettings)>,
}

include!("fixtures/limiter.rs");

const DATA: &[u8] = include_bytes!("fixtures/limiter.bin");

#[test]
fn has_the_javascripts_lookahead_and_meter_interval() {
    assert_eq!(LOOKAHEAD, JS_LOOKAHEAD);
    assert_eq!(METER_INTERVAL, JS_METER_INTERVAL);
}

#[test]
fn settings_from_db_match_the_javascript() {
    for case in CASES {
        let s = LimiterSettings::from_db(
            case.db.0,
            case.db.1,
            case.settings.release,
            case.settings.soft_clip,
        );
        // The JavaScript's were rounded to float32 on their way in.
        assert!(
            (s.ceiling - case.settings.ceiling).abs() < 1e-7,
            "{}",
            case.name
        );
        assert!(
            (s.gain - case.settings.gain).abs() < 1e-6 * s.gain,
            "{}",
            case.name
        );
    }
}

fn render(case: &Case, sig: &Signal) -> (Vec<f32>, Vec<f32>, Vec<LimiterMeters>) {
    let mut limiter = Limiter::new(SAMPLE_RATE, case.settings);
    let mut out_l = vec![0.0f32; FRAMES];
    let mut out_r = vec![0.0f32; FRAMES];
    let mut meters = Vec::new();
    for start in (0..FRAMES).step_by(BLOCK) {
        if let Some((at, settings)) = case.change
            && at == start
        {
            limiter.set(settings);
        }
        let range = start..(start + BLOCK).min(FRAMES);
        let n = range.len();
        limiter.process(
            Some(&sig.in_l[range.clone()]),
            (!case.mono).then(|| &sig.in_r[range.clone()]),
            &mut out_l[range.clone()],
            Some(&mut out_r[range]),
            n,
        );
        if let Some(m) = limiter.take_meters() {
            meters.push(m);
        }
    }
    (out_l, out_r, meters)
}

#[test]
fn renders_what_the_javascript_processor_renders() {
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    assert_eq!(
        sig.hash(),
        SIGNAL_HASH,
        "the test signal isn't the JavaScript's"
    );
    let mut data = FixtureReader::new(DATA);
    for case in CASES {
        let (out_l, out_r, meters) = render(case, &sig);
        let mut worst_sample = 0.0f64;
        for out in [&out_l, &out_r] {
            for i in (0..FRAMES).step_by(STRIDE) {
                worst_sample = worst_sample.max(f64::from((out[i] - data.f32()).abs()));
            }
        }
        let mut worst_meter = 0.0f64;
        for m in &meters {
            for value in [m.input, m.output, m.reduction] {
                worst_meter = worst_meter.max((value - data.f64()).abs());
            }
        }
        eprintln!(
            "{:<20} largest difference: samples {worst_sample:.1e}, meters {worst_meter:.1e}",
            case.name
        );
        assert!(
            worst_sample <= TOLERANCE && worst_meter <= TOLERANCE,
            "{}: off by up to {worst_sample:.1e} in the samples and {worst_meter:.1e} in the meters",
            case.name
        );
    }
    assert!(
        data.is_empty(),
        "the fixture has more data than its cases: remake it"
    );
}

#[test]
fn the_cases_limit() {
    // Most cases must actually reduce gain, or the fixture proves little.
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    for case in CASES.iter().filter(|c| c.name != "master") {
        let (_, _, meters) = render(case, &sig);
        let deepest = meters.iter().map(|m| m.reduction).fold(1.0, f64::min);
        assert!(
            deepest < 0.7,
            "{}: the gain only went down to {deepest:.2}",
            case.name
        );
    }
}
