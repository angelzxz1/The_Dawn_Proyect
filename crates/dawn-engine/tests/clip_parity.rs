//! Clips in the native engine against the studio's `mixClip`: plays the
//! clips in the fixture (made by src/engine/clipParity.test.ts) in blocks,
//! as the engine does, and compares with what the JavaScript mixed.

mod common;

use std::sync::Arc;

use common::{FixtureReader, Signal};
use dawn_engine::mix::{AudioData, Clip, ClipTiming};

/// The engine's own block length doesn't matter: a length that isn't a
/// power of two checks clips crossing block edges.
const BLOCK: usize = 100;

struct Case {
    stereo: bool,
    timing: ClipTiming,
}

include!("fixtures/clips.rs");

const DATA: &[u8] = include_bytes!("fixtures/clips.bin");

#[test]
fn plays_what_mix_clip_mixes() {
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    assert_eq!(
        sig.hash(),
        SIGNAL_HASH,
        "the test signal isn't the JavaScript's"
    );
    let mono = Arc::new(AudioData {
        channels: vec![sig.in_l.clone()],
    });
    let stereo = Arc::new(AudioData {
        channels: vec![sig.in_l.clone(), sig.in_r.clone()],
    });
    let clips: Vec<Clip> = CASES
        .iter()
        .map(|c| {
            Clip::new(
                if c.stereo {
                    stereo.clone()
                } else {
                    mono.clone()
                },
                SAMPLE_RATE,
                c.timing,
            )
        })
        .collect();
    let (mut l, mut r) = (vec![0.0f32; FRAMES], vec![0.0f32; FRAMES]);
    for start in (0..FRAMES).step_by(BLOCK) {
        let n = BLOCK.min(FRAMES - start);
        for clip in &clips {
            clip.render(start as i64, n, [&mut l[..], &mut r[..]], start);
        }
    }
    let mut data = FixtureReader::new(DATA);
    let mut worst = 0.0f64;
    for out in [&l, &r] {
        for i in (0..FRAMES).step_by(STRIDE) {
            worst = worst.max(f64::from((out[i] - data.f32()).abs()));
        }
    }
    eprintln!("largest difference: {worst:.1e}");
    assert!(worst <= 1e-7, "the clips are off by up to {worst:.1e}");
    assert!(
        data.is_empty(),
        "the fixture has more data than its clips: remake it"
    );
}
