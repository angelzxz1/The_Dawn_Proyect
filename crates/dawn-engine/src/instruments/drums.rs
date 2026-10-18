//! The Drum Rack's kernel, ported from `src/instruments/drum-rack/
//! drumKernel.ts` step for step (tests/drum_parity.rs checks it against
//! the JavaScript).
//!
//! A hit starts a voice on its exact sample. Synth pads model classic drum
//! machine circuits: the kick and toms are sines with a pitch drop, the
//! snare a tuned body plus filtered noise, the clap a few quick noise
//! bursts and a tail, hats and cymbals six detuned square waves (the 808
//! recipe) through band and high passes, and so on. Sample pads play their
//! file, tuned by resampling, optionally reversed and faded out. Each voice
//! then goes through its pad's filter, drive, level and pan. Pads in the
//! same choke group cut each other off with a 4 ms fade.
//!
//! As in the JavaScript, the voices render into float32 buffers and add
//! into float32 outputs, so the rounding happens where it happens there.

use std::f64::consts::{PI, SQRT_2};
use std::sync::Arc;

use super::{js_round, sat};
use crate::mix::AudioData;

pub const PAD_COUNT: usize = 16;
/// The note the first pad plays on (`drumParams.ts` FIRST_PAD_NOTE).
pub const FIRST_NOTE: i32 = 24;
const MAXV: usize = 32;
const PER_PAD: usize = 4;
/// The most frames one `process` call renders (a worklet's render
/// quantum); `render` splits longer blocks.
pub const QUANTUM: usize = 128;
/// Room for this many waiting events; more are dropped.
const EVENT_CAPACITY: usize = 1024;

const M_KICK: usize = 0;
const M_SNARE: usize = 1;
const M_CLAP: usize = 2;
const M_HAT: usize = 3;
const M_CYMBAL: usize = 4;
const M_TOM: usize = 5;
const M_RIM: usize = 6;
const M_COWBELL: usize = 7;
const M_SHAKER: usize = 8;
const METAL: [f64; 6] = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0];
const LN1000: f64 = 6.907755;

/// A pad's settings, as `compileDrumKit` makes them.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Pad {
    pub on: bool,
    /// Plays its sample (when one is loaded) rather than a synth model.
    pub sample: bool,
    /// Index into the models (kick, snare, clap, hat, cymbal, tom, rim,
    /// cowbell, shaker, clave).
    pub model: usize,
    pub tune: f64,
    pub decay: f64,
    pub tone: f64,
    pub character: f64,
    pub drive: f64,
    pub start: f64,
    pub reverse: bool,
    pub gain: f64,
    pub pan: f64,
    pub filter: f64,
    pub resonance: f64,
    pub velocity: f64,
    pub choke: i32,
}

/// A kit's settings, as `compileDrumKit` makes them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DrumKit {
    pub pads: [Pad; PAD_COUNT],
    /// Linear.
    pub volume: f64,
}

impl Default for DrumKit {
    fn default() -> Self {
        Self {
            pads: [Pad::default(); PAD_COUNT],
            volume: 1.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum DrumEventKind {
    /// A hit on the pad for `note` (its velocity 0-1).
    On { note: i32, vel: f64 },
    /// Every voice fades out.
    Panic,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DrumEvent {
    /// Seconds, on the clock `process` is given.
    pub time: f64,
    pub kind: DrumEventKind,
}

/// Per-sample factor for an exponential fall of 60 dB over t seconds.
fn decay_coef(t: f64, sr: f64) -> f64 {
    (-LN1000 / (t.max(1e-4) * sr)).exp()
}

/// Coefficients of a TPT state-variable filter: [a1, a2, a3, k].
fn svf_coefs(fc: f64, q: f64, sr: f64) -> [f64; 4] {
    let g = (PI * fc.min(sr * 0.45) / sr).tan();
    let k = 1.0 / q;
    let a1 = 1.0 / (1.0 + g * (g + k));
    [a1, g * a1, g * g * a1, k]
}

/// One step of the SVF; state is s[i], s[i+1]. Writes [low, band, high].
fn svf(c: &[f64; 4], s: &mut [f64], i: usize, x: f64, out: &mut [f64; 3]) {
    let v3 = x - s[i + 1];
    let v1 = c[0] * s[i] + c[1] * v3;
    let v2 = s[i + 1] + c[1] * s[i] + c[2] * v3;
    s[i] = 2.0 * v1 - s[i];
    s[i + 1] = 2.0 * v2 - s[i + 1];
    out[0] = v2;
    out[1] = c[3] * v1;
    out[2] = x - c[3] * v1 - v2;
}

#[derive(Clone, Copy)]
struct Voice {
    active: bool,
    pad: usize,
    age: u64,
    /// Frames since the hit.
    n: u64,
    vel: f64,
    fade: f64,
    fade_step: f64,
    ph: [f64; 8],
    s: [f64; 16],
    e: [f64; 6],
    k: [f64; 6],
    c: [[f64; 4]; 4],
    f: Option<[f64; 4]>,
    fs: [f64; 4],
    /// The pad's settings when it was hit.
    p: Pad,
    seed: u32,
    // Sample playback.
    pos: f64,
    inc: f64,
    len: usize,
    // Derived settings (see start).
    r: f64,
    tone: f64,
    ch: f64,
}

impl Voice {
    const IDLE: Voice = Voice {
        active: false,
        pad: 0,
        age: 0,
        n: 0,
        vel: 1.0,
        fade: 1.0,
        fade_step: 0.0,
        ph: [0.0; 8],
        s: [0.0; 16],
        e: [0.0; 6],
        k: [0.0; 6],
        c: [[0.0; 4]; 4],
        f: None,
        fs: [0.0; 4],
        p: Pad {
            on: false,
            sample: false,
            model: 0,
            tune: 0.0,
            decay: 0.0,
            tone: 0.0,
            character: 0.0,
            drive: 0.0,
            start: 0.0,
            reverse: false,
            gain: 0.0,
            pan: 0.0,
            filter: 0.0,
            resonance: 0.0,
            velocity: 0.0,
            choke: 0,
        },
        seed: 1,
        pos: 0.0,
        inc: 1.0,
        len: 0,
        r: 1.0,
        tone: 0.5,
        ch: 0.5,
    };

    fn noise(&mut self) -> f64 {
        let mut x = self.seed;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.seed = x;
        self.seed as f64 / 2147483648.0 - 1.0
    }
}

/// What the Drum Rack window shows live (`takeState`).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct DrumState {
    /// A bit per pad hit since the last report.
    pub hits: u32,
    pub peak: f64,
    pub voices: usize,
}

pub struct Drums {
    sr: f64,
    kit: Option<DrumKit>,
    samples: [Option<Arc<AudioData>>; PAD_COUNT],
    voices: Box<[Voice; MAXV]>,
    events: Vec<DrumEvent>,
    counter: u64,
    hits: u32,
    peak: f64,
    buf_l: [f32; QUANTUM],
    buf_r: [f32; QUANTUM],
}

impl Drums {
    pub fn new(sample_rate: f64) -> Self {
        Self {
            sr: sample_rate,
            kit: None,
            samples: Default::default(),
            voices: Box::new([Voice::IDLE; MAXV]),
            events: Vec::with_capacity(EVENT_CAPACITY),
            counter: 0,
            hits: 0,
            peak: 0.0,
            buf_l: [0.0; QUANTUM],
            buf_r: [0.0; QUANTUM],
        }
    }

    pub fn set_kit(&mut self, kit: DrumKit) {
        self.kit = Some(kit);
    }

    /// A pad's sample, at the kernel's rate (one or two channels), or none.
    pub fn set_sample(&mut self, pad: usize, data: Option<Arc<AudioData>>) {
        if pad < PAD_COUNT {
            self.samples[pad] = data.filter(|d| d.frames() > 0);
        }
    }

    /// The samples the pads have now (to hand back when they change, so
    /// they're freed off the audio thread).
    pub fn sample(&self, pad: usize) -> Option<&Arc<AudioData>> {
        self.samples.get(pad).and_then(Option::as_ref)
    }

    /// Queues an event, in time order (after those at the same time).
    pub fn add_event(&mut self, e: DrumEvent) {
        if self.events.len() == self.events.capacity() {
            return;
        }
        let mut i = self.events.len();
        while i > 0 && self.events[i - 1].time > e.time {
            i -= 1;
        }
        self.events.insert(i, e);
    }

    // --- voices ---

    fn fade_out(sr: f64, v: &mut Voice) {
        if v.fade_step == 0.0 {
            v.fade_step = 1.0 / (0.004 * sr);
        }
    }

    fn hit(&mut self, pad_index: i32, vel: f64) {
        let Some(kit) = &self.kit else {
            return;
        };
        if pad_index < 0 || pad_index >= PAD_COUNT as i32 {
            return;
        }
        let pad_index = pad_index as usize;
        let pads = kit.pads;
        let p = pads[pad_index];
        if !p.on {
            return;
        }
        if p.sample && self.samples[pad_index].is_none() {
            return;
        }
        self.hits |= 1 << pad_index;
        let sr = self.sr;
        // Choke: this pad's group (itself included) stops.
        let mut own = 0;
        for v in self.voices.iter_mut() {
            if !v.active {
                continue;
            }
            if p.choke > 0 && pads[v.pad].choke == p.choke {
                Self::fade_out(sr, v);
            } else if v.pad == pad_index && v.fade_step == 0.0 {
                own += 1;
            }
        }
        // Too many of this pad's hits ringing: fade the oldest.
        while own >= PER_PAD {
            let mut oldest: Option<usize> = None;
            for (i, v) in self.voices.iter().enumerate() {
                if v.active
                    && v.pad == pad_index
                    && v.fade_step == 0.0
                    && oldest.is_none_or(|o| v.age < self.voices[o].age)
                {
                    oldest = Some(i);
                }
            }
            let Some(o) = oldest else {
                break;
            };
            Self::fade_out(sr, &mut self.voices[o]);
            own -= 1;
        }
        let mut voice = self.voices.iter().position(|v| !v.active);
        if voice.is_none() {
            for (i, v) in self.voices.iter().enumerate() {
                if voice.is_none_or(|o| v.age < self.voices[o].age) {
                    voice = Some(i);
                }
            }
        }
        if let Some(i) = voice {
            self.start(i, pad_index, p, vel);
        }
    }

    fn start(&mut self, index: usize, pad_index: usize, p: Pad, vel: f64) {
        let sr = self.sr;
        self.counter += 1;
        let counter = self.counter;
        let sample_len = self.samples[pad_index].as_ref().map_or(0, |d| d.frames());
        let v = &mut self.voices[index];
        v.active = true;
        v.pad = pad_index;
        v.p = p;
        v.age = counter;
        v.n = 0;
        v.fade = 1.0;
        v.fade_step = 0.0;
        v.ph = [0.0; 8];
        v.s = [0.0; 16];
        v.fs = [0.0; 4];
        v.e = [0.0; 6];
        // `(counter * 2654435761) >>> 0 || 1`.
        let seed = (counter.wrapping_mul(2654435761) & 0xffff_ffff) as u32;
        v.seed = if seed == 0 { 1 } else { seed };
        let vs = p.velocity;
        v.vel = (1.0 - vs + vs * vel) * p.gain;
        v.r = 2f64.powf(p.tune / 12.0);
        v.tone = (p.tone + vs * (vel - 0.8) * 0.25).clamp(0.0, 1.0);
        v.ch = p.character;
        // The pad's filter: below 0 a low pass closes down, above 0 a high
        // pass opens up.
        if p.filter.abs() > 0.005 {
            let fc = if p.filter < 0.0 {
                20000.0 * 2f64.powf(p.filter * 10.0)
            } else {
                20.0 * 2f64.powf(p.filter * 10.0)
            };
            v.f = Some(svf_coefs(fc, 0.5 * 40f64.powf(p.resonance), sr));
        } else {
            v.f = None;
        }
        if p.sample {
            v.len = sample_len;
            v.inc = v.r;
            v.pos = p.start * v.len as f64;
            // A decay under the top fades the sample out; at the top it
            // plays to its end.
            v.e[0] = 1.0;
            v.k[0] = if p.decay >= 0.98 {
                1.0
            } else {
                decay_coef(0.03 + p.decay * p.decay * 4.0, sr)
            };
            return;
        }
        let d = p.decay;
        let ch = p.character;
        let t = v.tone;
        let r = v.r;
        let (e, k, c) = (&mut v.e, &mut v.k, &mut v.c);
        match p.model {
            M_KICK => {
                e[0] = 1.0;
                k[0] = decay_coef(0.08 + d.powf(1.5) * 1.6, sr);
                e[1] = 1.0;
                k[1] = (-1.0 / ((0.008 + (1.0 - ch) * 0.02) * sr)).exp();
                e[2] = 1.0;
                k[2] = (-1.0 / (0.0012 * sr)).exp();
            }
            M_SNARE => {
                e[0] = 1.0;
                k[0] = decay_coef(0.05 + d * 0.2, sr);
                e[1] = 1.0;
                k[1] = decay_coef(0.06 + d * 0.45, sr);
                e[2] = 1.0;
                k[2] = (-1.0 / (0.01 * sr)).exp();
                c[0] = svf_coefs(1500.0 + t * 6000.0, 0.8, sr);
                c[1] = svf_coefs(900.0, 0.7, sr);
            }
            M_CLAP => {
                e[0] = 1.0;
                k[0] = (-1.0 / (0.0045 * sr)).exp();
                e[1] = 0.0;
                k[1] = decay_coef(0.05 + d * 0.6, sr);
                c[0] = svf_coefs(700.0 + t * 2600.0, 1.6, sr);
            }
            M_HAT => {
                e[0] = 1.0;
                k[0] = decay_coef(0.02 + d * d * 1.2, sr);
                c[0] = svf_coefs(6500.0 + t * 5000.0, 1.1, sr);
                c[1] = svf_coefs(5500.0, 0.7, sr);
            }
            M_CYMBAL => {
                e[0] = 1.0;
                k[0] = decay_coef(0.4 + d * 3.5, sr);
                e[1] = 1.0;
                k[1] = decay_coef(0.25 + d * 1.6, sr);
                c[0] = svf_coefs(3000.0 + t * 6000.0, 0.6, sr);
                c[1] = svf_coefs(2200.0, 0.7, sr);
                c[2] = svf_coefs(1400.0 + t * 1200.0, 2.5, sr);
            }
            M_TOM => {
                e[0] = 1.0;
                k[0] = decay_coef(0.1 + d * 1.0, sr);
                e[1] = 1.0;
                k[1] = (-1.0 / (0.04 * sr)).exp();
                e[2] = 1.0;
                k[2] = (-1.0 / (0.008 * sr)).exp();
                c[0] = svf_coefs(1200.0, 1.0, sr);
            }
            M_RIM => {
                e[0] = 1.0;
                k[0] = decay_coef(0.015 + d * 0.12, sr);
                c[0] = svf_coefs(1700.0 * r, 5.0 + ch * 25.0, sr);
                c[1] = svf_coefs(500.0 * r, 3.0 + ch * 10.0, sr);
            }
            M_COWBELL => {
                e[0] = 1.0;
                k[0] = decay_coef(0.05 + d * 0.8, sr);
                e[1] = 1.0;
                k[1] = (-1.0 / (0.012 * sr)).exp();
                c[0] = svf_coefs(800.0 + t * 2000.0, 1.2, sr);
            }
            M_SHAKER => {
                e[0] = 0.0;
                k[0] = decay_coef(0.03 + d * 0.4, sr);
                e[1] = 1.0 / ((0.002 + ch * 0.04) * sr);
                c[0] = svf_coefs(3000.0 + t * 6000.0, 0.7, sr);
            }
            _ => {
                // The clave.
                e[0] = 1.0;
                k[0] = decay_coef(0.02 + d * 0.3, sr);
                e[1] = 1.0;
                k[1] = (-1.0 / (0.003 * sr)).exp();
            }
        }
    }

    /// Renders a synth voice (mono) into buf; returns false once it has
    /// died away (70 dB down).
    fn render_synth(sr: f64, v: &mut Voice, buf: &mut [f32], len: usize) -> bool {
        let two_pi = 2.0 * PI;
        let mut o = [0.0f64; 3];
        let r = v.r;
        let t = v.tone;
        let ch = v.ch;
        match v.p.model {
            M_KICK => {
                let f0 = 48.0 * r;
                let sweep = 1.0 + ch * 9.0;
                for x in buf.iter_mut().take(len) {
                    let f = f0 * (1.0 + sweep * v.e[1]);
                    v.ph[0] += f / sr;
                    if v.ph[0] >= 1.0 {
                        v.ph[0] -= 1.0;
                    }
                    let click = v.noise() * v.e[2] * t * 0.9;
                    *x = (((two_pi * v.ph[0]).sin() + click) * v.e[0]) as f32;
                    v.e[0] *= v.k[0];
                    v.e[1] *= v.k[1];
                    v.e[2] *= v.k[2];
                }
                v.e[0] > 3e-4
            }
            M_SNARE => {
                let snappy = 0.3 + ch * 1.3;
                let body = 1.0 - ch * 0.5;
                for x in buf.iter_mut().take(len) {
                    let drop = 1.0 + 0.4 * v.e[2];
                    v.ph[0] += (185.0 * r * drop) / sr;
                    if v.ph[0] >= 1.0 {
                        v.ph[0] -= 1.0;
                    }
                    v.ph[1] += (330.0 * r * drop) / sr;
                    if v.ph[1] >= 1.0 {
                        v.ph[1] -= 1.0;
                    }
                    let b =
                        ((two_pi * v.ph[0]).sin() * 0.6 + (two_pi * v.ph[1]).sin() * 0.4) * v.e[0];
                    let n = v.noise();
                    svf(&v.c[1], &mut v.s, 2, n, &mut o);
                    let hp = o[2];
                    svf(&v.c[0], &mut v.s, 0, hp, &mut o);
                    *x = (b * body + o[1] * 1.1 * v.e[1] * snappy) as f32;
                    v.e[0] *= v.k[0];
                    v.e[1] *= v.k[1];
                    v.e[2] *= v.k[2];
                }
                v.e[0] > 3e-4 || v.e[1] > 3e-4
            }
            M_CLAP => {
                let spacing = js_round((0.005 + ch * 0.012) * sr) as u64;
                for (i, x) in buf.iter_mut().take(len).enumerate() {
                    let n = v.n + i as u64;
                    // Four bursts, then the tail.
                    if n > 0 && n.is_multiple_of(spacing) && n <= spacing * 3 {
                        v.e[0] = 1.0 - (n as f64 / spacing as f64) * 0.12;
                        if n == spacing * 3 {
                            v.e[1] = 0.55;
                        }
                    }
                    let noise = v.noise();
                    svf(&v.c[0], &mut v.s, 0, noise, &mut o);
                    *x = (o[1] * 2.2 * (v.e[0] + v.e[1])) as f32;
                    v.e[0] *= v.k[0];
                    v.e[1] *= v.k[1];
                }
                v.n < spacing * 4 || v.e[1] > 3e-4
            }
            M_HAT | M_CYMBAL => {
                let cym = v.p.model == M_CYMBAL;
                let metal = if cym { 0.65 } else { 0.25 + ch * 0.75 };
                let bell = if cym { ch } else { 0.0 };
                for x in buf.iter_mut().take(len) {
                    let mut sq = 0.0;
                    for (ph, metal_hz) in v.ph.iter_mut().zip(METAL) {
                        *ph += (metal_hz * r * if cym { 1.0 } else { 1.9 }) / sr;
                        if *ph >= 1.0 {
                            *ph -= 1.0;
                        }
                        sq += if *ph < 0.5 { 1.0 } else { -1.0 };
                    }
                    sq /= 6.0;
                    let input = sq * metal + v.noise() * (1.0 - metal) * 0.8;
                    svf(&v.c[0], &mut v.s, 0, input, &mut o);
                    let band = o[1];
                    svf(&v.c[1], &mut v.s, 2, band, &mut o);
                    let mut y = o[2] * 2.4 * v.e[0];
                    if cym {
                        svf(&v.c[2], &mut v.s, 4, sq, &mut o);
                        y += o[1] * 1.6 * bell * v.e[1];
                        v.e[1] *= v.k[1];
                    }
                    *x = y as f32;
                    v.e[0] *= v.k[0];
                }
                v.e[0] > 3e-4
            }
            M_TOM => {
                let f0 = 110.0 * r;
                let sweep = 0.3 + ch * 1.2;
                for x in buf.iter_mut().take(len) {
                    v.ph[0] += (f0 * (1.0 + sweep * v.e[1])) / sr;
                    if v.ph[0] >= 1.0 {
                        v.ph[0] -= 1.0;
                    }
                    let noise = v.noise();
                    svf(&v.c[0], &mut v.s, 0, noise, &mut o);
                    *x = (((two_pi * v.ph[0]).sin() + o[1] * v.e[2] * t * 0.8) * v.e[0]) as f32;
                    v.e[0] *= v.k[0];
                    v.e[1] *= v.k[1];
                    v.e[2] *= v.k[2];
                }
                v.e[0] > 3e-4
            }
            M_RIM => {
                for (i, x) in buf.iter_mut().take(len).enumerate() {
                    let n = v.n + i as u64;
                    let input = if n == 0 { 1.0 } else { 0.0 }
                        + if (n as f64) < sr * 0.001 {
                            v.noise() * 0.4
                        } else {
                            0.0
                        };
                    svf(&v.c[0], &mut v.s, 0, input, &mut o);
                    let hi = o[1];
                    svf(&v.c[1], &mut v.s, 2, input, &mut o);
                    *x = ((hi * (0.4 + t) * 30.0 + o[1] * (1.4 - t) * 20.0) * v.e[0]) as f32;
                    v.e[0] *= v.k[0];
                }
                v.e[0] > 3e-4
            }
            M_COWBELL => {
                for x in buf.iter_mut().take(len) {
                    v.ph[0] += (540.0 * r) / sr;
                    if v.ph[0] >= 1.0 {
                        v.ph[0] -= 1.0;
                    }
                    v.ph[1] += (800.0 * r) / sr;
                    if v.ph[1] >= 1.0 {
                        v.ph[1] -= 1.0;
                    }
                    let input = (if v.ph[0] < 0.5 { 1.0 } else { -1.0 }) * (1.0 - ch * 0.6)
                        + (if v.ph[1] < 0.5 { 1.0 } else { -1.0 }) * (0.4 + ch * 0.6);
                    svf(&v.c[0], &mut v.s, 0, input, &mut o);
                    *x = (o[1] * 1.3 * (v.e[0] * 0.55 + v.e[1] * 0.45)) as f32;
                    v.e[0] *= v.k[0];
                    v.e[1] *= v.k[1];
                }
                v.e[0] > 3e-4
            }
            M_SHAKER => {
                for x in buf.iter_mut().take(len) {
                    // A linear rise, then the decay.
                    if v.e[1] > 0.0 {
                        v.e[0] += v.e[1];
                        if v.e[0] >= 1.0 {
                            v.e[0] = 1.0;
                            v.e[1] = 0.0;
                        }
                    } else {
                        v.e[0] *= v.k[0];
                    }
                    let noise = v.noise();
                    svf(&v.c[0], &mut v.s, 0, noise, &mut o);
                    *x = (o[2] * 0.8 * v.e[0]) as f32;
                }
                v.e[1] > 0.0 || v.e[0] > 3e-4
            }
            _ => {
                let f0 = (1200.0 + t * 1800.0) * r;
                for x in buf.iter_mut().take(len) {
                    let f = f0 * (1.0 + ch * 0.6 * v.e[1]);
                    v.ph[0] += f / sr;
                    if v.ph[0] >= 1.0 {
                        v.ph[0] -= 1.0;
                    }
                    v.ph[1] += (f * 2.71) / sr;
                    if v.ph[1] >= 1.0 {
                        v.ph[1] -= 1.0;
                    }
                    *x = (((two_pi * v.ph[0]).sin() + 0.2 * (two_pi * v.ph[1]).sin()) * v.e[0])
                        as f32;
                    v.e[0] *= v.k[0];
                    v.e[1] *= v.k[1];
                }
                v.e[0] > 3e-4
            }
        }
    }

    /// Renders a sample voice into buf_l (and buf_r if the sample is
    /// stereo).
    fn render_sample(
        data: &AudioData,
        v: &mut Voice,
        buf_l: &mut [f32],
        buf_r: &mut [f32],
        len: usize,
    ) -> bool {
        let left = &data.channels[0];
        let right = data.channels.get(1);
        let last = v.len as f64 - 1.0;
        let last_index = v.len.saturating_sub(1);
        let mut pos = v.pos;
        let mut env = v.e[0];
        let k = v.k[0];
        let mut i = 0;
        while i < len {
            if pos >= last {
                break;
            }
            let x = if v.p.reverse { last - pos } else { pos };
            let i0 = x.floor();
            let i1 = (i0 as usize + 1).min(last_index);
            let fr = x - i0;
            let i0 = i0 as usize;
            let (a, b) = (left[i0] as f64, left[i1] as f64);
            buf_l[i] = ((a + (b - a) * fr) * env) as f32;
            if let Some(right) = right {
                let (a, b) = (right[i0] as f64, right[i1] as f64);
                buf_r[i] = ((a + (b - a) * fr) * env) as f32;
            }
            pos += v.inc;
            env *= k;
            i += 1;
        }
        while i < len {
            buf_l[i] = 0.0;
            if right.is_some() {
                buf_r[i] = 0.0;
            }
            i += 1;
        }
        v.pos = pos;
        v.e[0] = env;
        pos < last && env > 1e-4
    }

    fn render_voice(
        &mut self,
        index: usize,
        out_l: &mut [f32],
        out_r: &mut [f32],
        off: usize,
        len: usize,
    ) {
        let sr = self.sr;
        let v = &mut self.voices[index];
        let p = v.p;
        let data = if p.sample {
            self.samples[v.pad].clone()
        } else {
            None
        };
        let stereo = data.as_ref().is_some_and(|d| d.channels.len() > 1);
        let alive = if p.sample {
            match &data {
                Some(d) => Self::render_sample(d, v, &mut self.buf_l, &mut self.buf_r, len),
                None => false,
            }
        } else {
            Self::render_synth(sr, v, &mut self.buf_l, len)
        };
        let mut o = [0.0f64; 3];
        let drive = p.drive > 0.001;
        let g = 1.0 + p.drive * 9.0;
        let makeup = 1.0 / (1.0 + p.drive * 0.25);
        let pan_l = (((p.pan + 1.0) * PI) / 4.0).cos() * SQRT_2;
        let pan_r = (((p.pan + 1.0) * PI) / 4.0).sin() * SQRT_2;
        let low = p.filter < 0.0;
        let mut fade = v.fade;
        let step = v.fade_step;
        for i in 0..len {
            let mut l = self.buf_l[i] as f64;
            let mut r = if stereo { self.buf_r[i] as f64 } else { l };
            if let Some(f) = &v.f {
                svf(f, &mut v.fs, 0, l, &mut o);
                l = if low { o[0] } else { o[2] };
                if stereo {
                    svf(f, &mut v.fs, 2, r, &mut o);
                    r = if low { o[0] } else { o[2] };
                } else {
                    r = l;
                }
            }
            if drive {
                l = sat(l * g) * makeup;
                r = if stereo { sat(r * g) * makeup } else { l };
            }
            let a = v.vel * fade;
            out_l[off + i] = (out_l[off + i] as f64 + l * a * pan_l) as f32;
            out_r[off + i] = (out_r[off + i] as f64 + r * a * pan_r) as f32;
            if step != 0.0 {
                fade -= step;
                if fade <= 0.0 {
                    fade = 0.0;
                    break;
                }
            }
        }
        v.fade = fade;
        v.n += len as u64;
        if !alive || fade <= 0.0 {
            v.active = false;
        }
        // The sample's last reference is the kit's or the engine's, never
        // this one: the clone above only borrowed it for the block.
        drop(data);
    }

    /// Renders `n` frames (at most `QUANTUM`) into out_l/out_r (cleared
    /// here); `now` is the clock time (s) of the first.
    pub fn process(&mut self, out_l: &mut [f32], out_r: &mut [f32], n: usize, now: f64) {
        out_l[..n].fill(0.0);
        out_r[..n].fill(0.0);
        let Some(vol) = self.kit.as_ref().map(|k| k.volume) else {
            return;
        };
        let sr = self.sr;
        let mut f = 0;
        while f < n {
            while let Some(e) = self.events.first().copied() {
                if js_round((e.time - now) * sr) > f as f64 {
                    break;
                }
                self.events.remove(0);
                match e.kind {
                    DrumEventKind::On { note, vel } => self.hit(note - FIRST_NOTE, vel),
                    DrumEventKind::Panic => {
                        for v in self.voices.iter_mut().filter(|v| v.active) {
                            Self::fade_out(sr, v);
                        }
                    }
                }
            }
            let mut len = n - f;
            if let Some(e) = self.events.first() {
                let at = js_round((e.time - now) * sr);
                if at > f as f64 && at - (f as f64) < len as f64 {
                    len = at as usize - f;
                }
            }
            for i in 0..MAXV {
                if self.voices[i].active {
                    self.render_voice(i, out_l, out_r, f, len);
                }
            }
            f += len;
        }
        let mut peak = self.peak;
        for i in 0..n {
            out_l[i] = (out_l[i] as f64 * vol) as f32;
            out_r[i] = (out_r[i] as f64 * vol) as f32;
            let a = (out_l[i].abs() as f64).max(out_r[i].abs() as f64);
            if a > peak {
                peak = a;
            }
        }
        self.peak = peak;
    }

    /// Renders any number of frames, a quantum at a time.
    pub fn render(&mut self, out_l: &mut [f32], out_r: &mut [f32], now: f64) {
        let n = out_l.len().min(out_r.len());
        let mut done = 0;
        while done < n {
            let len = (n - done).min(QUANTUM);
            let at = now + done as f64 / self.sr;
            self.process(&mut out_l[done..], &mut out_r[done..], len, at);
            done += len;
        }
    }

    pub fn active_count(&self) -> usize {
        self.voices.iter().filter(|v| v.active).count()
    }

    /// Pads hit since the last call (a bit each), and the output peak.
    pub fn take_state(&mut self) -> DrumState {
        let s = DrumState {
            hits: self.hits,
            peak: self.peak,
            voices: self.active_count(),
        };
        self.hits = 0;
        self.peak = 0.0;
        s
    }
}
