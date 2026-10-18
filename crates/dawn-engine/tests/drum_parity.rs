//! The Drum Rack port against the JavaScript kernel: renders the cases in
//! the fixture (made by src/instruments/drum-rack/drumParity.test.ts) the
//! way the worklet runs them, and compares the samples and the kernel's
//! state at the end with what the JavaScript rendered.

mod common;

use std::sync::Arc;

use common::{FixtureReader, Signal};
use dawn_engine::instruments::drums::{DrumEvent, DrumEventKind, DrumKit, Drums, Pad};
use dawn_engine::mix::AudioData;

/// -100 dB, well under anything audible (the run prints the largest
/// difference per case).
const TOLERANCE: f64 = 1e-5;

struct SampleSlice {
    from_key: bool,
    start: usize,
    end: usize,
}

struct Ev {
    at: usize,
    note: i32,
    vel: f64,
    panic: bool,
}

struct Case {
    name: &'static str,
    kit: DrumKit,
    samples: &'static [Option<SampleSlice>],
    events: &'static [Ev],
}

include!("fixtures/drums.rs");

const DATA: &[u8] = include_bytes!("fixtures/drums.bin");

fn sample(s: &SampleSlice, sig: &Signal) -> Arc<AudioData> {
    let channels = if s.from_key {
        vec![sig.key_l[s.start..s.end].to_vec()]
    } else {
        vec![
            sig.in_l[s.start..s.end].to_vec(),
            sig.in_r[s.start..s.end].to_vec(),
        ]
    };
    Arc::new(AudioData { channels })
}

#[test]
fn renders_what_the_javascript_kernel_renders() {
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    assert_eq!(sig.hash(), SIGNAL_HASH, "the test signals differ");
    let mut data = FixtureReader::new(DATA);
    for case in CASES {
        let mut k = Drums::new(SAMPLE_RATE);
        k.set_kit(case.kit);
        for (pad, s) in case.samples.iter().enumerate() {
            k.set_sample(pad, s.as_ref().map(|s| sample(s, &sig)));
        }
        for e in case.events {
            let time = START + e.at as f64 / SAMPLE_RATE;
            let kind = if e.panic {
                DrumEventKind::Panic
            } else {
                DrumEventKind::On {
                    note: e.note,
                    vel: e.vel,
                }
            };
            k.add_event(DrumEvent { time, kind });
        }
        let mut out_l = vec![0.0f32; FRAMES];
        let mut out_r = vec![0.0f32; FRAMES];
        let mut i = 0;
        while i < FRAMES {
            let n = BLOCK.min(FRAMES - i);
            k.process(
                &mut out_l[i..],
                &mut out_r[i..],
                n,
                START + i as f64 / SAMPLE_RATE,
            );
            i += n;
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
        let state = k.take_state();
        assert_eq!(state.hits as f64, data.f64(), "{}: pads hit", case.name);
        let peak = data.f64();
        assert!(
            (state.peak - peak).abs() <= TOLERANCE,
            "{}: peak {} vs {peak}",
            case.name,
            state.peak
        );
        assert_eq!(state.voices as f64, data.f64(), "{}: voices", case.name);
        println!("{}: largest difference {worst:e}", case.name);
    }
    assert!(data.is_empty(), "the fixture has more data than the cases");
}

#[test]
fn a_pad_out_of_range_or_without_its_sample_is_skipped() {
    let mut k = Drums::new(SAMPLE_RATE);
    let mut kit = DrumKit::default();
    kit.pads[0] = Pad {
        on: true,
        sample: true,
        gain: 1.0,
        ..Pad::default()
    };
    k.set_kit(kit);
    for note in [0, 24, 200] {
        k.add_event(DrumEvent {
            time: 0.0,
            kind: DrumEventKind::On { note, vel: 1.0 },
        });
    }
    let mut l = [0.0f32; 128];
    let mut r = [0.0f32; 128];
    k.process(&mut l, &mut r, 128, 0.0);
    assert_eq!(k.take_state().hits, 0);
    assert!(l.iter().all(|x| *x == 0.0));
}
