//! The browser's DelayNode, as Chromium runs it, for the effects the studio
//! builds from Web Audio nodes (the Chorus, the Delay).
//!
//! A port of Blink's `Delay` (`platform/audio/delay.cc`, with the x86 path
//! in `cpu/x86/delay_sse2.cc`, which renders every 128-frame block): the
//! delay time is read every sample, and the read position and the
//! interpolation between the two samples on either side of it are worked
//! out in float32. The buffer holds the longest delay and one block more,
//! so the position's rounding depends on its length, as in the browser.

/// The frames in a render quantum.
pub const QUANTUM: usize = 128;

/// One channel's delay line.
pub struct DelayLine {
    buf: Box<[f32]>,
    write: usize,
    len: f32,
    sample_rate: f32,
    max_delay: f32,
}

impl DelayLine {
    /// A line for delays up to `max_delay` seconds.
    pub fn new(max_delay: f64, sample_rate: f64) -> Self {
        // `BufferLengthForDelay`, through `TimeToSampleFrame` (rounded up).
        let frames = ((max_delay * sample_rate * 1024.0).round() / 1024.0).ceil() as usize;
        let len = QUANTUM + frames;
        Self {
            buf: vec![0.0; len].into_boxed_slice(),
            write: 0,
            len: len as f32,
            sample_rate: sample_rate as f32,
            max_delay: max_delay as f32,
        }
    }

    /// The delay time as the node's AudioParam holds it: float32, within 0
    /// to the longest delay.
    pub fn clamp(&self, seconds: f32) -> f32 {
        seconds.clamp(0.0, self.max_delay)
    }

    /// One sample in, and what's `delay` seconds (as `clamp` gives it) back
    /// out.
    #[inline]
    pub fn tick(&mut self, x: f32, delay: f32) -> f32 {
        let n = self.buf.len();
        self.buf[self.write] = x;
        let desired = delay.max(0.0) * self.sample_rate;
        let mut position = self.write as f32 + (self.len - desired);
        if position >= self.len {
            position -= self.len;
        }
        let mut i1 = position as usize;
        if i1 >= n {
            i1 -= n;
        }
        let i2 = if i1 + 1 >= n { i1 + 1 - n } else { i1 + 1 };
        let f = position - i1 as f32;
        // Past the newest sample only when f is 0, where it doesn't count.
        let (s1, s2) = (self.buf[i1], self.buf[i2]);
        self.write += 1;
        if self.write >= n {
            self.write = 0;
        }
        s1 + f * (s2 - s1)
    }
}
