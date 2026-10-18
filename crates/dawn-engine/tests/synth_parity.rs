//! The synth port against the JavaScript kernel: renders the cases in the
//! fixture (made by src/instruments/synth/synthParity.test.ts) the way the
//! worklet runs them, and compares the samples and the kernel's state at
//! the end with what the JavaScript rendered.

mod common;

use std::sync::Arc;

use common::{FixtureReader, Signal};
use dawn_engine::instruments::synth::{
    DESTS, EnvSettings, FRAME_SAMPLES, FilterSettings, LfoSettings, MAX_ROUTES, MIP_HARMONICS,
    MIP_SIZES, NoiseSettings, OscSettings, Route, STEP, SubSettings, Synth, SynthEvent,
    SynthEventKind, SynthSettings, VoiceSettings, Wavetable,
};
use dawn_engine::mix::AudioData;

/// -100 dB, well under anything audible (the run prints the largest
/// difference per case).
const TOLERANCE: f64 = 1e-5;

struct Ev {
    at: usize,
    kind: SynthEventKind,
}

struct Change {
    at: usize,
    settings: Option<SynthSettings>,
    bend: Option<f64>,
    wheel: Option<f64>,
}

struct Case {
    name: &'static str,
    settings: SynthSettings,
    tables: [bool; 3],
    bpm: f64,
    bend: f64,
    wheel: f64,
    events: &'static [Ev],
    changes: &'static [Change],
}

include!("fixtures/synth.rs");

const DATA: &[u8] = include_bytes!("fixtures/synth.bin");

/// The test tables, cut from the signal as the fixture's are.
fn tables(sig: &Signal) -> [Wavetable; 3] {
    let sources = [&sig.in_l, &sig.in_r, &sig.key_l];
    std::array::from_fn(|i| {
        let samples = sources[i][..TABLE_FRAMES[i] * FRAME_SAMPLES].to_vec();
        Wavetable::new(Arc::new(AudioData {
            channels: vec![samples],
        }))
        .expect("whole frames")
    })
}

fn near(what: &str, ours: f64, theirs: f64) {
    assert!(
        (ours - theirs).abs() <= TOLERANCE,
        "{what}: {ours} where the JavaScript has {theirs}"
    );
}

#[test]
fn has_the_javascript_kernels_constants() {
    assert_eq!(STEP, JS_STEP);
    assert_eq!(&DESTS[..], JS_DESTS);
    assert_eq!(&MIP_HARMONICS[..], JS_MIP_HARMONICS);
    assert_eq!(&MIP_SIZES[..], JS_MIP_SIZES);
}

#[test]
fn renders_what_the_javascript_kernel_renders() {
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    assert_eq!(sig.hash(), SIGNAL_HASH, "the test signals differ");
    let wavetables = tables(&sig);
    let mut data = FixtureReader::new(DATA);
    for case in CASES {
        let mut k = Synth::new(SAMPLE_RATE);
        k.set_bpm(case.bpm);
        k.set_bend(case.bend);
        k.set_mod_wheel(case.wheel);
        for (slot, has) in case.tables.iter().enumerate() {
            if *has {
                k.set_table(slot, Some(wavetables[slot].clone()));
            }
        }
        k.set_settings(&case.settings);
        for e in case.events {
            let time = START + e.at as f64 / SAMPLE_RATE;
            k.add_event(SynthEvent { time, kind: e.kind });
        }
        let mut out_l = vec![0.0f32; FRAMES];
        let mut out_r = vec![0.0f32; FRAMES];
        let mut i = 0;
        while i < FRAMES {
            for change in case.changes.iter().filter(|c| c.at == i) {
                if let Some(s) = &change.settings {
                    k.set_settings(s);
                }
                if let Some(bend) = change.bend {
                    k.set_bend(bend);
                }
                if let Some(wheel) = change.wheel {
                    k.set_mod_wheel(wheel);
                }
            }
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
        let name = case.name;
        let state = k.take_state();
        assert_eq!(state.voices as f64, data.f64(), "{name}: voices");
        near(&format!("{name}: left peak"), state.peak_l, data.f64());
        near(&format!("{name}: right peak"), state.peak_r, data.f64());
        let has = data.f64() == 1.0;
        assert_eq!(state.newest.is_some(), has, "{name}: a newest voice");
        let newest = state.newest;
        for d in 0..DESTS.len() {
            let theirs = data.f64();
            if let Some(v) = &newest {
                near(&format!("{name}: knob {d}"), v.modulated[d] as f64, theirs);
            }
        }
        for e in 0..3 {
            let (stage, level) = (data.f64(), data.f64());
            if let Some(v) = &newest {
                assert_eq!(v.env[e].0 as f64, stage, "{name}: envelope {e}'s stage");
                near(&format!("{name}: envelope {e}"), v.env[e].1, level);
            }
        }
        for (l, (phase, value)) in state.lfo.iter().enumerate() {
            near(&format!("{name}: LFO {l}'s phase"), *phase, data.f64());
            near(&format!("{name}: LFO {l}"), *value, data.f64());
        }
        println!("{name}: largest difference {worst:e}");
    }
    assert!(data.is_empty(), "the fixture has more data than the cases");
}

#[test]
fn a_wavetable_must_hold_whole_frames() {
    let table = |len: usize| {
        Wavetable::new(Arc::new(AudioData {
            channels: vec![vec![0.0; len]],
        }))
    };
    assert_eq!(table(FRAME_SAMPLES * 2).map(|t| t.frames()), Some(2));
    assert!(table(FRAME_SAMPLES + 1).is_none());
    assert!(table(0).is_none());
    assert!(Wavetable::new(Arc::new(AudioData { channels: vec![] })).is_none());
}

#[test]
fn settings_out_of_range_cant_reach_past_its_arrays() {
    let mut s = SynthSettings {
        osc: [OscSettings {
            on: true,
            warp: 99,
            unison: 99,
            dest: 99,
            phase: 0.0,
            random_phase: 1.0,
        }; 2],
        sub: SubSettings {
            on: true,
            shape: 9,
            octave: -1.0,
            dest: 7,
        },
        noise: NoiseSettings {
            on: true,
            pink: true,
            dest: 9,
        },
        filters: [FilterSettings {
            on: true,
            kind: 42,
            keytrack: 0.0,
        }; 2],
        envs: [EnvSettings {
            attack: 0.001,
            decay: 0.1,
            sustain: 1.0,
            release: 0.1,
            ..EnvSettings::default()
        }; 3],
        lfos: [LfoSettings {
            shape: 77,
            rate: 1.0,
            mode: 5,
            beats: 1.0,
            ..LfoSettings::default()
        }; 3],
        voice: VoiceSettings {
            mode: 0,
            polyphony: 99,
            glide: 0.0,
            bend_range: 2.0,
            velocity: 0.5,
        },
        ..SynthSettings::default()
    }
    .with_routes(&[
        Route {
            source: 99,
            dest: 0,
            amount: 1.0,
            bipolar: false,
        },
        Route {
            source: 0,
            dest: 99,
            amount: 1.0,
            bipolar: false,
        },
    ]);
    s.base = [0.5; DESTS.len()];
    assert_eq!(s.routes.len(), MAX_ROUTES);
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    let mut k = Synth::new(SAMPLE_RATE);
    for (slot, t) in tables(&sig).into_iter().enumerate() {
        k.set_table(slot, Some(t));
    }
    k.set_settings(&s);
    for note in [0, 60, 127, 200, -5] {
        k.add_event(SynthEvent {
            time: 0.0,
            kind: SynthEventKind::On { note, vel: 1.0 },
        });
    }
    let mut l = vec![0.0f32; 4096];
    let mut r = vec![0.0f32; 4096];
    k.render(&mut l, &mut r, 0.0);
    assert!(l.iter().chain(&r).all(|x| x.is_finite()));
    assert!(l.iter().any(|x| *x != 0.0));
}
