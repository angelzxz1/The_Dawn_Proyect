//! What the parity tests share: the test signal and the fixture data reader.
//! The JavaScript side is src/test/kernelParity.ts; the two must build the
//! same signal step for step (each fixture records its hash).

#![allow(dead_code)]

/// The test signal (see `paritySignal` in kernelParity.ts).
pub struct Signal {
    pub in_l: Vec<f32>,
    pub in_r: Vec<f32>,
    pub key_l: Vec<f32>,
    pub key_r: Vec<f32>,
}

impl Signal {
    pub fn new(frames: usize, sample_rate: f64) -> Self {
        let mut sig = Signal {
            in_l: vec![0.0; frames],
            in_r: vec![0.0; frames],
            key_l: vec![0.0; frames],
            key_r: vec![0.0; frames],
        };
        let mut seed: u32 = 0x2545_f491;
        let mut noise = move || {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (seed as f64) / 4_294_967_296.0 * 2.0 - 1.0
        };
        let inc_l = 110.0 / sample_rate;
        let inc_r = 165.0 / sample_rate;
        let (mut ph_l, mut ph_r, mut hit, mut key_env) = (0.0f64, 0.0f64, 0.0f64, 0.0f64);
        for i in 0..frames {
            let n_l = noise();
            let n_r = noise();
            let n_k = noise();
            ph_l += inc_l;
            if ph_l >= 1.0 {
                ph_l -= 1.0;
            }
            ph_r += inc_r;
            if ph_r >= 1.0 {
                ph_r -= 1.0;
            }
            let env = if i < 2400 {
                0.02
            } else if i < 7200 {
                0.9
            } else if i < 12000 {
                0.1
            } else {
                if (i - 12000) % 2400 == 0 {
                    hit = 0.8;
                } else {
                    hit *= 0.9995;
                }
                hit
            };
            sig.in_l[i] = (env * (0.7 * (2.0 * ph_l - 1.0) + 0.3 * n_l)) as f32;
            sig.in_r[i] = (env * (0.7 * (2.0 * ph_r - 1.0) + 0.3 * n_r)) as f32;
            if i % 3600 == 0 {
                key_env = 1.0;
            } else {
                key_env *= 0.999;
            }
            let k = key_env * 0.9 * n_k;
            sig.key_l[i] = k as f32;
            sig.key_r[i] = (k * 0.5) as f32;
        }
        sig
    }

    /// 32-bit FNV-1a over the samples' little-endian bytes (`fnv1a`).
    pub fn hash(&self) -> u32 {
        let mut h: u32 = 2_166_136_261;
        for a in [&self.in_l, &self.in_r, &self.key_l, &self.key_r] {
            for x in a.iter() {
                for b in x.to_bits().to_le_bytes() {
                    h ^= u32::from(b);
                    h = h.wrapping_mul(16_777_619);
                }
            }
        }
        h
    }
}

/// Reads a fixture's data file: runs of little-endian f32 and f64, in the
/// order the JavaScript wrote them (`FixtureData`).
pub struct FixtureReader<'a> {
    bytes: &'a [u8],
}

impl<'a> FixtureReader<'a> {
    pub fn new(bytes: &'a [u8]) -> Self {
        Self { bytes }
    }

    fn take<const N: usize>(&mut self) -> [u8; N] {
        let (head, rest) = self
            .bytes
            .split_first_chunk::<N>()
            .expect("the fixture's data file ends early: remake the fixture");
        self.bytes = rest;
        *head
    }

    pub fn f32(&mut self) -> f32 {
        f32::from_le_bytes(self.take())
    }

    pub fn f64(&mut self) -> f64 {
        f64::from_le_bytes(self.take())
    }

    pub fn is_empty(&self) -> bool {
        self.bytes.is_empty()
    }
}
