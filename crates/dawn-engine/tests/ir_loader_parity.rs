//! The IR Loader port against Chromium: renders the cases in the fixture
//! (made by src/effects/ir-loader/irLoaderParity.webaudio.test.ts, through
//! the studio's own nodes) in 128-frame blocks, as the browser does, each
//! with the same test impulse response, and compares the samples.

mod common;

use std::sync::Arc;

use common::{FixtureReader, Signal};
use dawn_engine::effects::ir_loader::{IrLoaderKernel, IrLoaderSettings};
use dawn_engine::mix::AudioData;

/// -86 dB. Chromium convolves through float32 FFTs and the port its own
/// way, so the sums round differently in their last bit (the run prints
/// the largest difference per case), and the low cut after the convolver,
/// a float32 high pass with its poles near DC, turns those roundings into
/// a slow drift: under 1e-6 at 200 Hz, a few 1e-5 at 50 Hz. A tap or a
/// frame out of place is far over this.
const TOLERANCE: f64 = 5e-5;

/// -46 dB, with the low cut Off and an IR in: Off is a 5 Hz high pass,
/// whose drift is a few 1e-4 (more after the Output gain), as with the
/// Saturator's DC blocker. Chromium's own output moves that much with its
/// input's last bits.
const LOW_CUT_OFF_TOLERANCE: f64 = 5e-3;

/// Whether the low cut is Off (its default) with an IR in.
fn drifts(case: &Case) -> bool {
    let off = |p: Params| {
        p.iter()
            .find(|(k, _)| *k == "lowCut")
            .is_none_or(|(_, v)| *v <= 20.5)
    };
    case.file != "none" && (off(case.params) || case.change.is_some_and(|(_, p, _)| off(p)))
}

const BLOCK: usize = 128;

type Params = &'static [(&'static str, f64)];

struct Case {
    name: &'static str,
    params: Params,
    /// The test's impulse response it starts with ("none" for none).
    file: &'static str,
    /// New parameters from this frame on, and maybe another file.
    change: Option<(usize, Params, Option<&'static str>)>,
}

include!("fixtures/ir_loader.rs");

const DATA: &[u8] = include_bytes!("fixtures/ir_loader.bin");

/// The test's impulse responses (`PARITY_IRS` in irLoaderParity.ts):
/// channels, frames, decay per frame, level, seed.
fn impulse(name: &str) -> Option<Arc<AudioData>> {
    let (channels, frames, decay, level, mut seed): (usize, usize, f64, f64, u32) = match name {
        "none" => return None,
        "cab" => (1, 1800, 0.995, 0.6, 11),
        "short" => (1, 90, 0.95, 1.0, 12),
        "room" => (2, 30000, 0.9998, 0.2, 13),
        "true-stereo" => (4, 6000, 0.999, 0.3, 14),
        "three" => (3, 700, 0.99, 0.5, 15),
        _ => panic!("no test impulse {name}"),
    };
    let channels = (0..channels)
        .map(|_| {
            let mut env = level;
            (0..frames)
                .map(|_| {
                    seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                    let v = env * (seed as f64 / 4_294_967_296.0 * 2.0 - 1.0);
                    env *= decay;
                    v as f32
                })
                .collect()
        })
        .collect();
    Some(Arc::new(AudioData { channels }))
}

#[test]
fn renders_what_chromium_renders() {
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    assert_eq!(sig.hash(), SIGNAL_HASH, "the test signals differ");
    let mut data = FixtureReader::new(DATA);
    for case in CASES {
        let tolerance = if drifts(case) {
            LOW_CUT_OFF_TOLERANCE
        } else {
            TOLERANCE
        };
        let mut settings = IrLoaderSettings::from_params(case.params);
        settings.file = impulse(case.file);
        settings.prepare(SAMPLE_RATE, None);
        let mut k = IrLoaderKernel::new(SAMPLE_RATE, &settings);
        let mut l = sig.in_l.clone();
        let mut r = sig.in_r.clone();
        for start in (0..FRAMES).step_by(BLOCK) {
            if let Some((_, params, file)) = case.change.filter(|(at, ..)| *at == start) {
                let mut next = IrLoaderSettings::from_params(params);
                next.file = match file {
                    Some(name) => impulse(name),
                    None => settings.file.clone(),
                };
                next.prepare(SAMPLE_RATE, Some(&settings));
                k.set(&next);
                settings = next;
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
