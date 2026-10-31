//! The browser's ConvolverNode, for the effects the studio builds on it
//! (the Reverb, the IR Loader).
//!
//! Chromium convolves in partitions through float32 FFTs; what that works
//! out is the plain convolution with the impulse, with no latency, and so
//! does this, its own way (so the last bits differ): the impulse's first
//! 128 taps directly, sample by sample; then, each through an FFT
//! (overlap-save), partitions of 128 taps up to the 2048th, of 1024 up to
//! the 16384th, and of 8192 for the rest. The longer partitions start two
//! blocks in, so they have a block to work in before they're heard: a
//! block's work (the transforms, a step at a time, and the products) is
//! spread over its quanta, which keeps each quantum's load about the same.
//!
//! The channels, as Chromium mixes them (the input is stereo; a mono input
//! plays as both sides): a mono impulse convolves each side; a stereo one
//! the left with its first channel and the right with its second; a
//! four-channel one ("true stereo") the left with its first two (into the
//! left and the right) and the right with its last two.
//!
//! An impulse is made off the audio thread (`Impulse`), and so is the state
//! convolving with it (`Convolver`). `ImpulseSlot` hands both to the audio
//! thread with a version of the song, and `Convolution` plays them, letting
//! the one a new impulse replaces ring out, as the studio does.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use super::delay_node::QUANTUM;

/// The taps convolved directly.
const HEAD: usize = QUANTUM;

/// How many convolvers can ring out at once; a new impulse past that cuts
/// the oldest tail short.
const RING_OUT: usize = 2;

// --- The FFT ---

/// What a real FFT of `2 * block` points needs: a complex FFT of `block`
/// (its bit reversal and twiddles) and the twiddles that split its result.
/// Its steps run one at a time, so a long one can be spread over quanta.
struct FftTables {
    /// The complex FFT's points (`block`).
    m: usize,
    /// Its butterfly stages (log2 m).
    stages: usize,
    rev: Box<[usize]>,
    /// e^(-2πik/m), k < m/2.
    tw_re: Box<[f32]>,
    tw_im: Box<[f32]>,
    /// e^(-2πik/2m), k <= m.
    split_re: Box<[f32]>,
    split_im: Box<[f32]>,
}

impl FftTables {
    fn new(m: usize) -> Self {
        let n = 2 * m;
        let stages = m.trailing_zeros() as usize;
        let rev = (0..m)
            .map(|i| i.reverse_bits() >> (usize::BITS as usize - stages))
            .collect();
        let turn = |k: usize, of: usize| {
            let a = -2.0 * std::f64::consts::PI * k as f64 / of as f64;
            (a.cos() as f32, a.sin() as f32)
        };
        let (tw_re, tw_im): (Vec<f32>, Vec<f32>) = (0..m / 2).map(|k| turn(k, m)).unzip();
        let (split_re, split_im): (Vec<f32>, Vec<f32>) = (0..=m).map(|k| turn(k, n)).unzip();
        Self {
            m,
            stages,
            rev,
            tw_re: tw_re.into(),
            tw_im: tw_im.into(),
            split_re: split_re.into(),
            split_im: split_im.into(),
        }
    }

    /// The tables for partitions of `block` (made on first use, off the
    /// audio thread, with the first impulse).
    fn for_block(block: usize) -> &'static Self {
        static TABLES: [OnceLock<FftTables>; 3] =
            [OnceLock::new(), OnceLock::new(), OnceLock::new()];
        let i = TIERS.iter().position(|t| t.block == block).unwrap_or(0);
        TABLES[i].get_or_init(|| Self::new(block))
    }

    /// The steps of a forward or inverse transform: getting the input in
    /// (in bit-reversed order), the butterfly stages, getting the result
    /// out.
    fn steps(&self) -> usize {
        self.stages + 2
    }

    fn bit_reverse(&self, re: &mut [f32], im: &mut [f32]) {
        for i in 0..self.m {
            let j = self.rev[i];
            if i < j {
                re.swap(i, j);
                im.swap(i, j);
            }
        }
    }

    /// Butterfly stage `s` (1 to `stages`) of the complex FFT, in place.
    fn stage(&self, re: &mut [f32], im: &mut [f32], s: usize, inverse: bool) {
        let m = self.m;
        let len = 1 << s;
        let half = len / 2;
        let step = m / len;
        for start in (0..m).step_by(len) {
            for k in 0..half {
                let wr = self.tw_re[k * step];
                let wi = if inverse {
                    -self.tw_im[k * step]
                } else {
                    self.tw_im[k * step]
                };
                let (a, b) = (start + k, start + k + half);
                let tr = re[b] * wr - im[b] * wi;
                let ti = re[b] * wi + im[b] * wr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
            }
        }
    }

    /// Step `step` of the spectrum (bins 0 to m) of `x`'s `2m` samples,
    /// into `re`/`im`, with `z` (m each) for the complex FFT.
    fn forward_step(
        &self,
        step: usize,
        x: &[f32],
        z: (&mut [f32], &mut [f32]),
        re: &mut [f32],
        im: &mut [f32],
    ) {
        let m = self.m;
        let (zr, zi) = z;
        if step == 0 {
            for k in 0..m {
                zr[k] = x[2 * k];
                zi[k] = x[2 * k + 1];
            }
            self.bit_reverse(zr, zi);
        } else if step <= self.stages {
            self.stage(zr, zi, step, false);
        } else {
            // The even samples' spectrum and the odd's, from Z and its
            // mirror.
            for k in 0..=m {
                let (ar, ai) = (zr[k % m], zi[k % m]);
                let j = (m - k) % m;
                let (br, bi) = (zr[j], -zi[j]);
                let (er, ei) = (0.5 * (ar + br), 0.5 * (ai + bi));
                let (or, oi) = (0.5 * (ai - bi), -0.5 * (ar - br));
                let (wr, wi) = (self.split_re[k], self.split_im[k]);
                re[k] = er + (wr * or - wi * oi);
                im[k] = ei + (wr * oi + wi * or);
            }
        }
    }

    /// Step `step` of `2m` times the samples whose spectrum (bins 0 to m)
    /// is `re`/`im`, into `x`.
    fn inverse_step(
        &self,
        step: usize,
        re: &[f32],
        im: &[f32],
        z: (&mut [f32], &mut [f32]),
        x: &mut [f32],
    ) {
        let m = self.m;
        let (zr, zi) = z;
        if step == 0 {
            for k in 0..m {
                let (ar, ai) = (re[k], im[k]);
                let (br, bi) = (re[m - k], -im[m - k]);
                let (er, ei) = (ar + br, ai + bi);
                let (dr, di) = (ar - br, ai - bi);
                let (wr, wi) = (self.split_re[k], -self.split_im[k]);
                let (or, oi) = (dr * wr - di * wi, dr * wi + di * wr);
                zr[k] = er - oi;
                zi[k] = ei + or;
            }
            self.bit_reverse(zr, zi);
        } else if step <= self.stages {
            self.stage(zr, zi, step, true);
        } else {
            for k in 0..m {
                x[2 * k] = zr[k];
                x[2 * k + 1] = zi[k];
            }
        }
    }
}

// --- The impulse ---

/// A length of partitions: their length, where in the impulse they start
/// and stop, and the quanta their block takes. Those after the first start
/// two blocks in, so they have a block to work in before they're heard.
struct TierShape {
    block: usize,
    from: usize,
    to: usize,
    /// Heard a block after their input's block is in (the first, which
    /// starts a block in), rather than two.
    soon: bool,
}

const TIERS: [TierShape; 3] = [
    TierShape {
        block: QUANTUM,
        from: HEAD,
        to: 2048,
        soon: true,
    },
    TierShape {
        block: 1024,
        from: 2048,
        to: 16384,
        soon: false,
    },
    TierShape {
        block: 8192,
        from: 16384,
        to: usize::MAX,
        soon: false,
    },
];

/// A run of partitions' spectra, one after another (`bins` each), scaled
/// by the inverse FFT's 1/n.
struct Spectra {
    parts: usize,
    re: Box<[f32]>,
    im: Box<[f32]>,
}

impl Spectra {
    fn new(taps: &[f32], shape: &TierShape) -> Self {
        let (block, from) = (shape.block, shape.from);
        let to = shape.to.min(taps.len());
        let parts = if to > from {
            (to - from).div_ceil(block)
        } else {
            0
        };
        let bins = block + 1;
        let t = FftTables::for_block(block);
        let scale = 1.0 / (2 * block) as f32;
        let mut re = zeros(parts * bins);
        let mut im = zeros(parts * bins);
        let (mut x, mut zr, mut zi) = (zeros(2 * block), zeros(block), zeros(block));
        for p in 0..parts {
            let start = from + p * block;
            let end = (start + block).min(to);
            x.fill(0.0);
            for (to, tap) in x.iter_mut().zip(&taps[start..end]) {
                *to = tap * scale;
            }
            let range = p * bins..(p + 1) * bins;
            for step in 0..t.steps() {
                t.forward_step(
                    step,
                    &x,
                    (&mut zr, &mut zi),
                    &mut re[range.clone()],
                    &mut im[range.clone()],
                );
            }
        }
        Self { parts, re, im }
    }
}

/// One channel of an impulse, cut up.
struct Taps {
    /// The first taps, last first (to run against the input oldest first).
    head: Box<[f32]>,
    tiers: [Spectra; 3],
}

/// An impulse response, ready to convolve with.
pub struct Impulse {
    len: usize,
    channels: Box<[Taps]>,
}

impl Impulse {
    /// From its channels: 1, 2 or 4 (others keep their first two, as the
    /// studio has them). An impulse of no samples is a single silent one.
    pub fn new(channels: &[&[f32]]) -> Self {
        let silent = [0.0f32];
        let channels: Vec<&[f32]> = match channels.len() {
            0 => vec![&silent],
            1 | 2 | 4 => channels.to_vec(),
            _ => channels[..2].to_vec(),
        };
        let len = channels.iter().map(|c| c.len()).max().unwrap_or(0).max(1);
        let channels = channels
            .iter()
            .map(|taps| {
                let mut head = zeros(HEAD);
                for (i, tap) in taps.iter().take(HEAD).enumerate() {
                    head[HEAD - 1 - i] = *tap;
                }
                Taps {
                    head,
                    tiers: TIERS.each_ref().map(|shape| Spectra::new(taps, shape)),
                }
            })
            .collect();
        Self { len, channels }
    }

    /// Its length, in frames: how long it rings after its input stops.
    pub fn len(&self) -> usize {
        self.len
    }

    /// Never: an impulse has a frame at least.
    pub fn is_empty(&self) -> bool {
        false
    }

    /// Which input side runs through which of its channels into which
    /// output side.
    fn lanes(&self) -> &'static [(usize, usize, usize)] {
        match self.channels.len() {
            1 => &[(0, 0, 0), (1, 0, 1)],
            2 => &[(0, 0, 0), (1, 1, 1)],
            _ => &[(0, 0, 0), (0, 1, 1), (1, 2, 0), (1, 3, 1)],
        }
    }
}

impl std::fmt::Debug for Impulse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Impulse({} channels, {} frames)",
            self.channels.len(),
            self.len
        )
    }
}

// --- Convolving ---

/// Zeros, written out (so the memory is the process's before the audio
/// thread touches it, rather than on its first write).
fn zeros(n: usize) -> Box<[f32]> {
    let mut v = vec![0.0f32; n].into_boxed_slice();
    std::hint::black_box(&mut v[..]).fill(0.0);
    v
}

/// The convolution with one length of partitions. Each block's work (the
/// input's spectrum, the products, the sums back into samples) is a list
/// of jobs, run a share at a time each quantum.
struct Tier {
    index: usize,
    block: usize,
    parts: usize,
    /// The quanta in a block.
    quanta: usize,
    soon: bool,
    /// Each input side's last two blocks, the newer one filling, and the
    /// copy whose spectrum is being worked out.
    input: [Box<[f32]>; 2],
    window: [Box<[f32]>; 2],
    /// The complex FFTs' room, a pair per side.
    z: [[Box<[f32]>; 2]; 2],
    /// Each input side's spectra of its last `parts` windows (a ring, the
    /// newest at `newest`).
    seen_re: [Box<[f32]>; 2],
    seen_im: [Box<[f32]>; 2],
    newest: usize,
    /// Each output side's sum of products, being worked out.
    sum_re: [Box<[f32]>; 2],
    sum_im: [Box<[f32]>; 2],
    /// Each output side's samples for the block playing, and for the next.
    out: [Box<[f32]>; 2],
    next: [Box<[f32]>; 2],
    /// Each output side's samples back from the sums.
    time: [Box<[f32]>; 2],
    /// The next job.
    job: usize,
}

impl Tier {
    fn new(index: usize, parts: usize) -> Self {
        let shape = &TIERS[index];
        // A tier with nothing to do keeps nothing.
        let (b, p) = if parts == 0 {
            (0, 0)
        } else {
            (shape.block, parts)
        };
        let bins = if parts == 0 { 0 } else { b + 1 };
        let pair = |n: usize| [zeros(n), zeros(n)];
        Self {
            index,
            block: shape.block,
            parts,
            quanta: shape.block / QUANTUM,
            soon: shape.soon,
            input: pair(2 * b),
            window: pair(2 * b),
            z: [pair(b), pair(b)],
            seen_re: pair(p * bins),
            seen_im: pair(p * bins),
            newest: 0,
            sum_re: pair(bins),
            sum_im: pair(bins),
            out: pair(b),
            next: pair(b),
            time: pair(2 * b),
            job: 0,
        }
    }

    /// The jobs in a block: each input side's transform, each partition's
    /// products, each output side's transform back.
    fn jobs(&self) -> usize {
        let steps = FftTables::for_block(self.block).steps();
        4 * steps + self.parts
    }

    fn run_job(&mut self, impulse: &Impulse, job: usize) {
        let t = FftTables::for_block(self.block);
        let steps = t.steps();
        let bins = self.block + 1;
        if job < 2 * steps {
            let (s, step) = (job / steps, job % steps);
            let range = self.newest * bins..(self.newest + 1) * bins;
            let [zr, zi] = &mut self.z[s];
            t.forward_step(
                step,
                &self.window[s],
                (zr, zi),
                &mut self.seen_re[s][range.clone()],
                &mut self.seen_im[s][range],
            );
        } else if job < 2 * steps + self.parts {
            self.add_products(impulse, job - 2 * steps);
        } else {
            let job = job - 2 * steps - self.parts;
            let (o, step) = (job / steps, job % steps);
            let [zr, zi] = &mut self.z[o];
            t.inverse_step(
                step,
                &self.sum_re[o],
                &self.sum_im[o],
                (zr, zi),
                &mut self.time[o],
            );
            if step == steps - 1 {
                self.next[o].copy_from_slice(&self.time[o][self.block..]);
                self.sum_re[o].fill(0.0);
                self.sum_im[o].fill(0.0);
            }
        }
    }

    /// Adds the products of partition `j` (of each lane's channel) with
    /// the window `j` blocks back.
    fn add_products(&mut self, impulse: &Impulse, j: usize) {
        let bins = self.block + 1;
        let slot = (self.newest + self.parts - j) % self.parts;
        for &(input, channel, output) in impulse.lanes() {
            let h = &impulse.channels[channel].tiers[self.index];
            if j >= h.parts {
                continue;
            }
            let x_re = &self.seen_re[input][slot * bins..(slot + 1) * bins];
            let x_im = &self.seen_im[input][slot * bins..(slot + 1) * bins];
            let h_re = &h.re[j * bins..(j + 1) * bins];
            let h_im = &h.im[j * bins..(j + 1) * bins];
            let sum_re = &mut self.sum_re[output][..bins];
            let sum_im = &mut self.sum_im[output][..bins];
            for b in 0..bins {
                sum_re[b] += x_re[b] * h_re[b] - x_im[b] * h_im[b];
                sum_im[b] += x_re[b] * h_im[b] + x_im[b] * h_re[b];
            }
        }
    }

    /// The work at the end of a quantum; `phase` is the quanta since this
    /// block started (0 when one just has).
    fn quantum(&mut self, impulse: &Impulse, phase: usize) {
        if self.parts == 0 {
            return;
        }
        if phase == 0 {
            // The block that's played its next takes it; the input block
            // that's in starts its spectrum.
            if !self.soon {
                std::mem::swap(&mut self.out, &mut self.next);
            }
            self.newest = (self.newest + 1) % self.parts;
            for s in 0..2 {
                self.window[s].copy_from_slice(&self.input[s]);
                self.input[s].copy_within(self.block.., 0);
            }
            self.job = 0;
        }
        let jobs = self.jobs();
        let until = (jobs * (phase + 1)).div_ceil(self.quanta);
        while self.job < until {
            self.run_job(impulse, self.job);
            self.job += 1;
        }
        if self.soon {
            std::mem::swap(&mut self.out, &mut self.next);
        }
    }
}

/// A dot product, in eight runs (so it vectorizes).
#[inline]
fn dot(a: &[f32], b: &[f32]) -> f32 {
    let mut acc = [0.0f32; 8];
    for (ca, cb) in a.as_chunks::<8>().0.iter().zip(b.as_chunks::<8>().0) {
        for i in 0..8 {
            acc[i] += ca[i] * cb[i];
        }
    }
    acc.iter().sum()
}

/// A convolution with one impulse running: what it keeps of its input, and
/// what it's working out.
pub struct Convolver {
    impulse: Arc<Impulse>,
    /// Frames into the quantum, and quanta since it started.
    at: usize,
    quanta: usize,
    /// Each input side's last `HEAD` samples, twice over, so the newest
    /// `HEAD` are always in one run (ending at `pos + HEAD`).
    history: [Box<[f32]>; 2],
    pos: usize,
    tiers: [Tier; 3],
}

impl Convolver {
    /// Off the audio thread: it allocates.
    pub fn new(impulse: Arc<Impulse>) -> Self {
        // The longest channel's partitions.
        let parts = |i: usize| {
            impulse
                .channels
                .iter()
                .map(|t| t.tiers[i].parts)
                .max()
                .unwrap_or(0)
        };
        Self {
            at: 0,
            quanta: 0,
            history: [zeros(2 * HEAD), zeros(2 * HEAD)],
            pos: 0,
            tiers: [
                Tier::new(0, parts(0)),
                Tier::new(1, parts(1)),
                Tier::new(2, parts(2)),
            ],
            impulse,
        }
    }

    pub fn impulse(&self) -> &Impulse {
        &self.impulse
    }

    #[inline]
    fn tick(&mut self, x: [f32; 2]) -> [f32; 2] {
        let pos = self.pos;
        for (h, x) in self.history.iter_mut().zip(x) {
            h[pos] = x;
            h[pos + HEAD] = x;
        }
        let mut y = [0.0f32; 2];
        for &(input, channel, output) in self.impulse.lanes() {
            let window = &self.history[input][pos + 1..pos + 1 + HEAD];
            y[output] += dot(window, &self.impulse.channels[channel].head);
        }
        self.pos = (pos + 1) % HEAD;
        for tier in &mut self.tiers {
            if tier.parts == 0 {
                continue;
            }
            let f = (self.quanta % tier.quanta) * QUANTUM + self.at;
            for (input, x) in tier.input.iter_mut().zip(x) {
                input[tier.block + f] = x;
            }
            y[0] += tier.out[0][f];
            y[1] += tier.out[1][f];
        }
        self.at += 1;
        if self.at == QUANTUM {
            self.at = 0;
            self.quanta += 1;
            let impulse = &*self.impulse;
            for tier in &mut self.tiers {
                let phase = self.quanta % tier.quanta;
                tier.quantum(impulse, phase);
            }
        }
        y
    }

    /// Convolves a stereo block in place.
    pub fn process(&mut self, l: &mut [f32], r: &mut [f32]) {
        for (x_l, x_r) in l.iter_mut().zip(r.iter_mut()) {
            [*x_l, *x_r] = self.tick([*x_l, *x_r]);
        }
    }

    /// Adds to a stereo block what it puts out with no more input. With no
    /// input Chromium takes it as mono, and a mono impulse on a mono input
    /// makes a mono output: the left side's tail, heard on both.
    pub fn ring(&mut self, l: &mut [f32], r: &mut [f32]) {
        let mono = self.impulse.channels.len() == 1;
        for (x_l, x_r) in l.iter_mut().zip(r.iter_mut()) {
            let [y_l, y_r] = self.tick([0.0, 0.0]);
            *x_l += y_l;
            *x_r += if mono { y_l } else { y_r };
        }
    }
}

// --- Handing impulses to the audio thread ---

/// An impulse on its way to the audio thread with a version of the song,
/// and a convolver made for it. The audio thread takes the convolver once,
/// and puts back the ones that have rung out, so they're freed with the
/// song, off the audio thread. Its locks are only ever tried, never waited
/// on.
pub struct ImpulseSlot {
    serial: u64,
    impulse: Option<Arc<Impulse>>,
    ready: Mutex<Option<Box<Convolver>>>,
    // Boxed, as the audio thread has them: moving one out of its box would
    // free the box there.
    #[allow(clippy::vec_box)]
    done: Mutex<Vec<Box<Convolver>>>,
}

impl ImpulseSlot {
    /// With an impulse, or none (the effect passes its input through).
    pub fn new(impulse: Option<Impulse>) -> Arc<Self> {
        static SERIAL: AtomicU64 = AtomicU64::new(1);
        let impulse = impulse.map(Arc::new);
        let ready = impulse.clone().map(|i| Box::new(Convolver::new(i)));
        Arc::new(Self {
            serial: SERIAL.fetch_add(1, Ordering::Relaxed),
            impulse,
            ready: Mutex::new(ready),
            done: Mutex::new(Vec::with_capacity(RING_OUT)),
        })
    }

    pub fn impulse(&self) -> Option<&Impulse> {
        self.impulse.as_deref()
    }

    fn take(&self) -> Option<Box<Convolver>> {
        self.ready.try_lock().ok().and_then(|mut r| r.take())
    }

    /// Keeps a convolver that's done, to be freed with the slot.
    fn keep(&self, convolver: Box<Convolver>) {
        if let Ok(mut done) = self.done.try_lock()
            && done.len() < done.capacity()
        {
            done.push(convolver);
        }
        // (Never full: a slot takes at most RING_OUT, once.)
    }
}

impl std::fmt::Debug for ImpulseSlot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "ImpulseSlot({}, {:?})", self.serial, self.impulse)
    }
}

struct Ringing {
    convolver: Box<Convolver>,
    /// The frames until it's silent.
    left: usize,
}

/// What an effect plays its convolver through: the one for its impulse,
/// and those of impulses it replaced, ringing out their tails with no more
/// input (the studio feeds a new ConvolverNode and stops feeding the old).
pub struct Convolution {
    serial: u64,
    current: Option<Box<Convolver>>,
    ringing: [Option<Ringing>; RING_OUT],
}

impl Convolution {
    /// Off the audio thread: with the slot's convolver, or a new one for
    /// its impulse if that's been taken.
    pub fn new(slot: &ImpulseSlot) -> Self {
        let current = slot.take().or_else(|| {
            slot.impulse
                .clone()
                .map(|impulse| Box::new(Convolver::new(impulse)))
        });
        Self {
            serial: slot.serial,
            current,
            ringing: Default::default(),
        }
    }

    /// Whether there's an impulse to convolve with (none passes the input
    /// through).
    pub fn has_impulse(&self) -> bool {
        self.current.is_some()
    }

    /// Takes the slot's impulse if it's a new one (on the audio thread: it
    /// only moves what the slot made). The one playing rings out.
    pub fn take(&mut self, slot: &ImpulseSlot) {
        if slot.serial == self.serial {
            return;
        }
        let next = if slot.impulse.is_some() {
            match slot.take() {
                Some(convolver) => Some(convolver),
                // Taken already: carry on with the one playing.
                None => return,
            }
        } else {
            None
        };
        self.serial = slot.serial;
        // Those that have rung out go to be freed with the slot.
        for ringing in &mut self.ringing {
            if ringing.as_ref().is_some_and(|r| r.left == 0)
                && let Some(r) = ringing.take()
            {
                slot.keep(r.convolver);
            }
        }
        let Some(old) = std::mem::replace(&mut self.current, next) else {
            return;
        };
        // A free place, or the one closest to silent.
        let place = self
            .ringing
            .iter()
            .position(Option::is_none)
            .unwrap_or_else(|| {
                (0..RING_OUT)
                    .min_by_key(|&i| self.ringing[i].as_ref().map_or(0, |r| r.left))
                    .unwrap_or(0)
            });
        if let Some(cut) = self.ringing[place].take() {
            slot.keep(cut.convolver);
        }
        let left = old.impulse.len();
        self.ringing[place] = Some(Ringing {
            convolver: old,
            left,
        });
    }

    /// The signal convolved in place (or left as it is with no impulse),
    /// with the tails ringing out added.
    pub fn process(&mut self, l: &mut [f32], r: &mut [f32]) {
        let n = l.len().min(r.len());
        if let Some(c) = &mut self.current {
            c.process(&mut l[..n], &mut r[..n]);
        }
        for ringing in self.ringing.iter_mut().flatten() {
            let m = n.min(ringing.left);
            if m > 0 {
                ringing.convolver.ring(&mut l[..m], &mut r[..m]);
                ringing.left -= m;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A test signal: an LCG's noise.
    fn noise(n: usize, seed: u32) -> Vec<f32> {
        let mut s = seed;
        (0..n)
            .map(|_| {
                s = s.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                (s as f64 / 4_294_967_296.0 * 2.0 - 1.0) as f32
            })
            .collect()
    }

    /// The convolution worked out plainly, in f64.
    fn direct(x: &[f32], h: &[f32]) -> Vec<f64> {
        (0..x.len())
            .map(|t| {
                (0..h.len().min(t + 1))
                    .map(|k| h[k] as f64 * x[t - k] as f64)
                    .sum()
            })
            .collect()
    }

    /// Runs `x` through in blocks of the given sizes, in turn.
    fn run(c: &mut Convolver, l: &mut [f32], r: &mut [f32], blocks: &[usize]) {
        let (mut at, mut i) = (0, 0);
        while at < l.len() {
            let n = blocks[i % blocks.len()].min(l.len() - at);
            c.process(&mut l[at..at + n], &mut r[at..at + n]);
            at += n;
            i += 1;
        }
    }

    fn worst(a: &[f32], b: &[f64]) -> f64 {
        a.iter()
            .zip(b)
            .map(|(a, b)| (*a as f64 - b).abs())
            .fold(0.0, f64::max)
    }

    #[test]
    fn convolves_with_no_latency_at_every_length() {
        // In the head, the short partitions, the long ones, and past a long
        // partition's edge; in blocks that don't line up with the quanta.
        for len in [1, 100, 128, 129, 700, 2048, 2049, 5000, 9000] {
            let h = noise(len, 7).iter().map(|v| v * 0.1).collect::<Vec<_>>();
            let x = noise(12000, 3);
            let mut c = Convolver::new(Arc::new(Impulse::new(&[&h])));
            let (mut l, mut r) = (x.clone(), x.clone());
            run(&mut c, &mut l, &mut r, &[37, 128, 500, 1, 2048]);
            let want = direct(&x, &h);
            let d = worst(&l, &want).max(worst(&r, &want));
            assert!(d < 2e-5, "{len} taps: off by {d}");
        }
    }

    #[test]
    fn convolves_with_a_long_impulse_through_every_partition() {
        // Taps here and there to 60000 (through all three lengths of
        // partition, and their edges), worked out plainly from those.
        let mut h = vec![0.0f32; 60000];
        let mut taps = vec![
            0, 1, 127, 128, 2047, 2048, 16383, 16384, 24575, 24576, 59999,
        ];
        let mut s = 99u32;
        for _ in 0..40 {
            s = s.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            taps.push(s as usize % 60000);
        }
        for (i, &t) in taps.iter().enumerate() {
            h[t] = if i % 2 == 0 { 0.3 } else { -0.2 };
        }
        taps.sort();
        taps.dedup();
        let x = noise(70000, 21);
        let mut c = Convolver::new(Arc::new(Impulse::new(&[&h, &h])));
        let (mut l, mut r) = (x.clone(), x.clone());
        run(&mut c, &mut l, &mut r, &[300, 128, 1000, 17]);
        let want: Vec<f64> = (0..x.len())
            .map(|t| {
                taps.iter()
                    .filter(|&&k| k <= t)
                    .map(|&k| h[k] as f64 * x[t - k] as f64)
                    .sum()
            })
            .collect();
        let d = worst(&l, &want).max(worst(&r, &want));
        assert!(d < 2e-5, "off by {d}");
    }

    #[test]
    fn mixes_channels_as_chromium_does() {
        let taps = |at: usize, len: usize| {
            let mut h = vec![0.0f32; len];
            h[at] = 1.0;
            h
        };
        let mut l = vec![0.0f32; 6000];
        let mut r = vec![0.0f32; 6000];
        l[10] = 1.0;
        r[50] = 0.5;
        // True stereo: L <- L*h0 + R*h2, R <- L*h1 + R*h3.
        let (h0, h1, h2, h3) = (taps(0, 10), taps(3000, 4000), taps(200, 300), taps(2, 3));
        let mut c = Convolver::new(Arc::new(Impulse::new(&[&h0, &h1, &h2, &h3])));
        c.process(&mut l, &mut r);
        let at = |v: &[f32]| {
            v.iter()
                .enumerate()
                .filter(|(_, x)| x.abs() > 1e-4)
                .map(|(i, x)| (i, (x * 1000.0).round() / 1000.0))
                .collect::<Vec<_>>()
        };
        assert_eq!(at(&l), vec![(10, 1.0), (250, 0.5)]);
        assert_eq!(at(&r), vec![(52, 0.5), (3010, 1.0)]);
    }

    #[test]
    fn a_replaced_impulse_rings_out() {
        let h = noise(3000, 11).iter().map(|v| v * 0.05).collect::<Vec<_>>();
        let x = noise(8000, 5);
        // The whole convolution, and one split at a new (same) impulse:
        // the old one's tail and the new one's start add up to the same.
        let want = direct(&x, &h);
        let first = ImpulseSlot::new(Some(Impulse::new(&[&h])));
        let mut c = Convolution::new(&first);
        let (mut l, mut r) = (x.clone(), x.clone());
        let split = 2500;
        c.process(&mut l[..split], &mut r[..split]);
        let second = ImpulseSlot::new(Some(Impulse::new(&[&h])));
        c.take(&second);
        c.take(&second);
        c.process(&mut l[split..], &mut r[split..]);
        assert!(worst(&l, &want) < 2e-5);
        // With no impulse, the input passes, plus what's still ringing.
        let none = ImpulseSlot::new(None);
        c.take(&none);
        assert!(!c.has_impulse());
        let (mut l, mut r) = (vec![0.0f32; 4000], vec![0.0f32; 4000]);
        l[3600] = 1.0;
        c.process(&mut l, &mut r);
        assert!(l[..3000].iter().any(|v| v.abs() > 1e-3), "still ringing");
        assert!(l[3000..3600].iter().all(|v| *v == 0.0), "rang out");
        assert_eq!(l[3600], 1.0);
    }

    #[test]
    fn a_mono_impulse_rings_out_its_left_tail_on_both_sides() {
        let h = noise(1500, 13).iter().map(|v| v * 0.05).collect::<Vec<_>>();
        let mut c = Convolution::new(&ImpulseSlot::new(Some(Impulse::new(&[&h]))));
        let (mut l, mut r) = (noise(3000, 1), noise(3000, 2));
        c.process(&mut l, &mut r);
        c.take(&ImpulseSlot::new(None));
        let (mut l, mut r) = (vec![0.0f32; 1500], vec![0.0f32; 1500]);
        c.process(&mut l, &mut r);
        assert_eq!(l, r);
        // The left's tail: the convolution of what went in, past its end.
        let mut x = noise(3000, 1);
        x.resize(4500, 0.0);
        let tail = direct(&x, &h);
        assert!(worst(&l, &tail[3000..]) < 2e-5);
    }
}
