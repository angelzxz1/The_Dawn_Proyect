//! Audio clips: what one plays at each moment of the timeline - its loop
//! played out, its gain, its linear fades in and out.
//!
//! Port of `mixClip` in `src/engine/clipAudio.ts` (how consolidating
//! renders clips, and how the browser engine plays them), in frames from
//! the start of the timeline; `tests/clip_parity.rs` holds the port to what
//! the JavaScript renders.

use std::sync::Arc;

/// JavaScript's `Math.round`: halves go up.
pub(crate) fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// A file's decoded audio, one array per channel (mono plays in both).
#[derive(Debug, Default)]
pub struct AudioData {
    pub channels: Vec<Vec<f32>>,
}

impl AudioData {
    pub fn frames(&self) -> usize {
        self.channels.first().map_or(0, Vec::len)
    }
}

/// A clip on a track, in frames at the engine's rate.
#[derive(Clone, Debug)]
pub struct Clip {
    pub audio: Arc<AudioData>,
    /// Where it starts on the timeline.
    pub start: i64,
    /// How long it plays.
    pub frames: i64,
    /// Where in the file its audio starts.
    pub source_start: i64,
    /// When over 0, the file from `source_start` repeats every this many
    /// frames.
    pub loop_frames: i64,
    /// Linear.
    pub gain: f64,
    /// Fade lengths, in (fractional) frames.
    pub fade_in: f64,
    pub fade_out: f64,
}

/// A clip as the studio keeps it (`AudioClipInstance`): seconds and dB.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ClipTiming {
    /// Where it starts on the timeline.
    pub offset: f64,
    pub length: f64,
    /// Where in the file its audio starts.
    pub source_offset: f64,
    /// When set and over 0, the file from `source_offset` repeats.
    pub loop_length: Option<f64>,
    pub gain_db: f64,
    pub fade_in: f64,
    pub fade_out: f64,
}

impl Clip {
    /// A clip from the studio's fields, at `sample_rate`.
    pub fn new(audio: Arc<AudioData>, sample_rate: f64, t: ClipTiming) -> Self {
        Self {
            audio,
            start: js_round(t.offset * sample_rate) as i64,
            frames: js_round(t.length * sample_rate) as i64,
            source_start: js_round(t.source_offset * sample_rate) as i64,
            loop_frames: t
                .loop_length
                .filter(|l| *l > 0.0)
                .map_or(0, |l| js_round(l * sample_rate) as i64),
            gain: 10f64.powf(t.gain_db / 20.0),
            fade_in: t.fade_in * sample_rate,
            fade_out: t.fade_out * sample_rate,
        }
    }

    /// The first frame after it.
    pub fn end(&self) -> i64 {
        self.start + self.frames
    }

    /// Adds what it plays over timeline frames `[pos, pos + n)` into the
    /// outputs from index `at`.
    pub fn render(&self, pos: i64, n: usize, outs: [&mut [f32]; 2], at: usize) {
        let channels = &self.audio.channels;
        if channels.is_empty() || self.frames <= 0 {
            return;
        }
        let first = (self.start - pos).max(0);
        let last = (self.end() - pos).min(n as i64);
        if first >= last {
            return;
        }
        for (c, out) in outs.into_iter().enumerate() {
            let source = &channels[c.min(channels.len() - 1)];
            for i in first..last {
                let k = pos + i - self.start;
                let s = self.source_start
                    + if self.loop_frames > 0 {
                        k % self.loop_frames
                    } else {
                        k
                    };
                if s < 0 || s as usize >= source.len() {
                    continue;
                }
                let mut g = self.gain;
                let kf = k as f64;
                if kf < self.fade_in {
                    g *= kf / self.fade_in;
                }
                let left = (self.frames - k) as f64;
                if left < self.fade_out {
                    g *= left / self.fade_out;
                }
                let o = &mut out[at + i as usize];
                *o = (*o as f64 + source[s as usize] as f64 * g) as f32;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn audio(channels: Vec<Vec<f32>>) -> Arc<AudioData> {
        Arc::new(AudioData { channels })
    }

    #[test]
    fn plays_its_part_of_the_file_where_it_sits() {
        let t = ClipTiming {
            offset: 1.0,
            length: 2.0,
            source_offset: 3.0,
            ..Default::default()
        };
        let clip = Clip::new(audio(vec![(0..100).map(|i| i as f32).collect()]), 10.0, t);
        let (mut l, mut r) = (vec![0.0; 40], vec![0.0; 40]);
        clip.render(0, 40, [&mut l, &mut r], 0);
        // From timeline frame 10 for 20 frames, the file from frame 30.
        assert_eq!(l[9], 0.0);
        assert_eq!(l[10], 30.0);
        assert_eq!(r[29], 49.0);
        assert_eq!(l[30], 0.0);
    }

    #[test]
    fn loops_and_fades() {
        let t = ClipTiming {
            length: 2.0,
            loop_length: Some(0.5),
            fade_in: 0.5,
            fade_out: 0.5,
            ..Default::default()
        };
        let clip = Clip::new(audio(vec![vec![1.0; 100]]), 10.0, t);
        let (mut l, mut r) = (vec![0.0; 20], vec![0.0; 20]);
        clip.render(0, 20, [&mut l, &mut r], 0);
        assert_eq!(l[0], 0.0);
        assert_eq!(l[2], 0.4);
        assert_eq!(l[10], 1.0);
        assert_eq!(l[19], 0.2);
    }

    #[test]
    fn renders_a_block_in_the_middle() {
        let t = ClipTiming {
            length: 10.0,
            ..Default::default()
        };
        let clip = Clip::new(audio(vec![(0..100).map(|i| i as f32).collect()]), 10.0, t);
        let (mut l, mut r) = (vec![0.0; 8], vec![0.0; 8]);
        clip.render(50, 4, [&mut l, &mut r], 4);
        assert_eq!(&l[4..], &[50.0, 51.0, 52.0, 53.0]);
    }
}
