//! The audio interface playing the engine: the device's callback owns the
//! engine and renders it into the device's buffer. The app talks to it
//! only through lock-free queues: commands in, finished songs out (freed
//! here, never on the audio thread), and through atomics it reads -
//! position, meters, dropouts, how busy the callback is.
//!
//! cpal's stream can't move between threads on every system, so a thread
//! of its own opens it and keeps it until it's told to close.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, mpsc};
use std::thread;
use std::time::Instant;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, Device, FromSample, SampleFormat, SizedSample, StreamConfig};
use dawn_engine::mix::{Engine, Prepared};
use rtrb::{Consumer, Producer, RingBuffer};

/// Meters kept for this many tracks and buses (more are unmetered).
pub const MAX_METERED: usize = 256;
/// The longest buffer the callback renders in one go (frames); a device
/// asking for more is filled in parts.
const SCRATCH: usize = 8192;

/// A command for the audio thread.
pub enum Command {
    Song(Box<Prepared>),
    Play { from: f64, count_in_beats: f64 },
    Stop,
    Seek(f64),
    Loop(Option<(f64, f64)>),
    Metronome(bool),
    MetronomeLevel(f64),
}

/// What the audio thread shares: written there, read by the app.
pub struct Status {
    position: AtomicU64,
    playing: AtomicBool,
    /// Peaks since last read, as f32 bits (left, right per track, then
    /// bus, then the master's two).
    peaks: Vec<AtomicU32>,
    /// The share of each buffer's time the last callbacks took (0-1, as
    /// f32 bits, smoothed).
    load: AtomicU32,
    /// Dropouts and other stream errors since it opened.
    errors: AtomicU32,
    /// The limiter's gain reduction, from its last meter reading (f32 bits).
    limiter_gain: AtomicU32,
}

impl Status {
    fn new() -> Self {
        Self {
            position: AtomicU64::new(0),
            playing: AtomicBool::new(false),
            peaks: (0..(2 * MAX_METERED * 2 + 2))
                .map(|_| AtomicU32::new(0))
                .collect(),
            load: AtomicU32::new(0),
            errors: AtomicU32::new(0),
            limiter_gain: AtomicU32::new(1.0f32.to_bits()),
        }
    }

    fn keep_peak(&self, slot: usize, value: f32) {
        if let Some(a) = self.peaks.get(slot) {
            a.fetch_max(value.to_bits(), Ordering::Relaxed);
        }
    }

    fn take_peak(&self, slot: usize) -> f32 {
        self.peaks
            .get(slot)
            .map_or(0.0, |a| f32::from_bits(a.swap(0, Ordering::Relaxed)))
    }

    pub fn position(&self) -> f64 {
        f64::from_bits(self.position.load(Ordering::Relaxed))
    }

    pub fn playing(&self) -> bool {
        self.playing.load(Ordering::Relaxed)
    }

    pub fn load(&self) -> f32 {
        f32::from_bits(self.load.load(Ordering::Relaxed))
    }

    pub fn errors(&self) -> u32 {
        self.errors.load(Ordering::Relaxed)
    }

    pub fn limiter_gain(&self) -> f32 {
        f32::from_bits(self.limiter_gain.load(Ordering::Relaxed))
    }

    /// Reads and resets the peaks of `tracks` tracks and `buses` buses, and
    /// the master's.
    pub fn take_peaks(
        &self,
        tracks: usize,
        buses: usize,
    ) -> (Vec<[f32; 2]>, Vec<[f32; 2]>, [f32; 2]) {
        let t = (0..tracks.min(MAX_METERED))
            .map(|i| [self.take_peak(2 * i), self.take_peak(2 * i + 1)])
            .collect();
        let base = 2 * MAX_METERED;
        let b = (0..buses.min(MAX_METERED))
            .map(|i| {
                [
                    self.take_peak(base + 2 * i),
                    self.take_peak(base + 2 * i + 1),
                ]
            })
            .collect();
        let m = 4 * MAX_METERED;
        (t, b, [self.take_peak(m), self.take_peak(m + 1)])
    }
}

/// What's playing through the device.
pub struct Running {
    pub sample_rate: f64,
    pub buffer_size: Option<u32>,
    pub status: Arc<Status>,
    commands: Producer<Command>,
    finished: Consumer<Box<Prepared>>,
    close: mpsc::Sender<()>,
    thread: Option<thread::JoinHandle<()>>,
}

impl Running {
    /// Sends a command to the audio thread; first frees the songs it's
    /// done with. False when the queue is full (the audio thread stalled).
    pub fn send(&mut self, command: Command) -> bool {
        while let Ok(done) = self.finished.pop() {
            drop(done);
        }
        self.commands.push(command).is_ok()
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.close.send(());
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// The audio thread's side.
struct Callback {
    engine: Engine,
    commands: Consumer<Command>,
    finished: Producer<Box<Prepared>>,
    status: Arc<Status>,
    left: Vec<f32>,
    right: Vec<f32>,
    channels: usize,
    sample_rate: f64,
}

impl Callback {
    fn apply(&mut self) {
        while let Ok(command) = self.commands.pop() {
            match command {
                Command::Song(song) => {
                    let old = self.engine.set_song(song);
                    // If the app's side is full, the song is freed here: rare,
                    // and better than holding it.
                    let _ = self.finished.push(old);
                }
                Command::Play {
                    from,
                    count_in_beats,
                } => self.engine.play(from, count_in_beats),
                Command::Stop => self.engine.stop(),
                Command::Seek(s) => self.engine.seek(s),
                Command::Loop(l) => self.engine.set_loop(l),
                Command::Metronome(on) => self.engine.set_metronome(on),
                Command::MetronomeLevel(db) => self.engine.set_metronome_level(db),
            }
        }
    }

    fn render<T: SizedSample + FromSample<f32>>(&mut self, data: &mut [T]) {
        let started = Instant::now();
        self.apply();
        let frames = data.len() / self.channels;
        let mut done = 0;
        while done < frames {
            let n = (frames - done).min(SCRATCH);
            self.engine
                .render(&mut self.left[..n], &mut self.right[..n]);
            for i in 0..n {
                let frame = &mut data[(done + i) * self.channels..(done + i + 1) * self.channels];
                frame[0] = T::from_sample(self.left[i]);
                if self.channels > 1 {
                    frame[1] = T::from_sample(self.right[i]);
                    for x in &mut frame[2..] {
                        *x = T::EQUILIBRIUM;
                    }
                }
            }
            done += n;
        }
        let status = &self.status;
        status
            .position
            .store(self.engine.position_seconds().to_bits(), Ordering::Relaxed);
        status
            .playing
            .store(self.engine.playing(), Ordering::Relaxed);
        let master = self.engine.take_peaks(
            |i, p| {
                status.keep_peak(2 * i, p[0]);
                status.keep_peak(2 * i + 1, p[1]);
            },
            |i, p| {
                status.keep_peak(2 * MAX_METERED + 2 * i, p[0]);
                status.keep_peak(2 * MAX_METERED + 2 * i + 1, p[1]);
            },
        );
        status.keep_peak(4 * MAX_METERED, master[0]);
        status.keep_peak(4 * MAX_METERED + 1, master[1]);
        if let Some(m) = self.engine.take_limiter_meters() {
            status
                .limiter_gain
                .store((m.reduction as f32).to_bits(), Ordering::Relaxed);
        }
        if frames > 0 {
            let budget = frames as f64 / self.sample_rate;
            let used = (started.elapsed().as_secs_f64() / budget) as f32;
            let before = f32::from_bits(status.load.load(Ordering::Relaxed));
            status
                .load
                .store((before * 0.9 + used * 0.1).to_bits(), Ordering::Relaxed);
        }
    }
}

/// How to open a device.
pub struct Request {
    /// A device id from `devices::list`, or none for the system's default.
    pub device: Option<String>,
    pub sample_rate: Option<u32>,
    pub buffer_size: Option<u32>,
}

fn find_device(id: Option<&str>) -> Result<Device, String> {
    let Some(id) = id else {
        return cpal::default_host()
            .default_output_device()
            .ok_or("There's no audio output device.".into());
    };
    let device_id: cpal::DeviceId = id.parse().map_err(|e| format!("{e}"))?;
    let host = cpal::host_from_id(device_id.host()).map_err(|e| format!("{e}"))?;
    host.device_by_id(&device_id)
        .ok_or_else(|| "That audio device isn't connected.".to_owned())
}

/// What the stream's thread hands back once the device is playing.
struct Opened {
    sample_rate: f64,
    status: Arc<Status>,
    commands: Producer<Command>,
    finished: Consumer<Box<Prepared>>,
}

/// Opens the device and starts the engine playing through it.
pub fn open(request: Request) -> Result<Running, String> {
    let (ready_tx, ready_rx) = mpsc::channel::<Result<Opened, String>>();
    let (close_tx, close_rx) = mpsc::channel::<()>();
    let buffer_size = request.buffer_size;
    let thread = thread::Builder::new()
        .name("dawn-audio-device".into())
        .spawn(move || {
            let opened = (|| {
                let device = find_device(request.device.as_deref())?;
                let default = device.default_output_config().map_err(|e| format!("{e}"))?;
                let sample_rate = request
                    .sample_rate
                    .filter(|r| {
                        device.supported_output_configs().is_ok_and(|mut c| {
                            c.any(|c| c.min_sample_rate() <= *r && *r <= c.max_sample_rate())
                        })
                    })
                    .unwrap_or(default.sample_rate());
                let config = StreamConfig {
                    channels: default.channels().max(1),
                    sample_rate,
                    buffer_size: request
                        .buffer_size
                        .map_or(BufferSize::Default, BufferSize::Fixed),
                };
                let status = Arc::new(Status::new());
                let (commands_tx, commands_rx) = RingBuffer::<Command>::new(256);
                let (finished_tx, finished_rx) = RingBuffer::<Box<Prepared>>::new(64);
                let callback = Callback {
                    engine: Engine::new(f64::from(sample_rate)),
                    commands: commands_rx,
                    finished: finished_tx,
                    status: status.clone(),
                    left: vec![0.0; SCRATCH],
                    right: vec![0.0; SCRATCH],
                    channels: usize::from(config.channels),
                    sample_rate: f64::from(sample_rate),
                };
                let stream = build(
                    &device,
                    &config,
                    default.sample_format(),
                    callback,
                    status.clone(),
                )?;
                stream.play().map_err(|e| format!("{e}"))?;
                Ok((
                    stream,
                    Opened {
                        sample_rate: f64::from(sample_rate),
                        status,
                        commands: commands_tx,
                        finished: finished_rx,
                    },
                ))
            })();
            match opened {
                Ok((stream, parts)) => {
                    let _ = ready_tx.send(Ok(parts));
                    // Keeps the stream until told to close (or the app goes).
                    let _ = close_rx.recv();
                    drop(stream);
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                }
            }
        })
        .map_err(|e| format!("{e}"))?;
    let opened = ready_rx.recv().map_err(|e| format!("{e}"))??;
    Ok(Running {
        sample_rate: opened.sample_rate,
        buffer_size,
        status: opened.status,
        commands: opened.commands,
        finished: opened.finished,
        close: close_tx,
        thread: Some(thread),
    })
}

fn build(
    device: &Device,
    config: &StreamConfig,
    format: SampleFormat,
    callback: Callback,
    status: Arc<Status>,
) -> Result<cpal::Stream, String> {
    fn typed<T: SizedSample + FromSample<f32> + 'static>(
        device: &Device,
        config: &StreamConfig,
        mut callback: Callback,
        status: Arc<Status>,
    ) -> Result<cpal::Stream, String> {
        device
            .build_output_stream::<T, _, _>(
                *config,
                move |data: &mut [T], _| callback.render(data),
                move |_| {
                    status.errors.fetch_add(1, Ordering::Relaxed);
                },
                None,
            )
            .map_err(|e| format!("{e}"))
    }
    match format {
        SampleFormat::F32 => typed::<f32>(device, config, callback, status),
        SampleFormat::F64 => typed::<f64>(device, config, callback, status),
        SampleFormat::I16 => typed::<i16>(device, config, callback, status),
        SampleFormat::I32 => typed::<i32>(device, config, callback, status),
        SampleFormat::U16 => typed::<u16>(device, config, callback, status),
        other => Err(format!(
            "The device's sample format ({other:?}) isn't supported yet."
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peaks_are_kept_until_read() {
        let s = Status::new();
        s.keep_peak(0, 0.5);
        s.keep_peak(0, 0.25);
        s.keep_peak(4 * MAX_METERED + 1, 0.75);
        let (tracks, _, master) = s.take_peaks(1, 0);
        assert_eq!(tracks, [[0.5, 0.0]]);
        assert_eq!(master, [0.0, 0.75]);
        assert_eq!(s.take_peaks(1, 0).0, [[0.0, 0.0]]);
    }
}

#[cfg(test)]
mod device_tests {
    use super::*;

    /// Run by hand: lists the devices and plays a second through the
    /// default one (`cargo test -p dawn-desktop -- --ignored --nocapture`).
    #[test]
    #[ignore]
    fn plays_through_the_default_device() {
        for d in crate::audio::devices::list() {
            eprintln!("{} ({}): {} devices", d.name, d.id, d.devices.len());
            for dev in &d.devices {
                eprintln!(
                    "  {} [{}] rates {:?} buffers {:?}-{:?}",
                    dev.name, dev.id, dev.sample_rates, dev.min_buffer, dev.max_buffer
                );
            }
        }
        let mut running = open(Request {
            device: std::env::var("DAWN_TEST_DEVICE").ok(),
            sample_rate: None,
            buffer_size: Some(256),
        })
        .expect("opens");
        eprintln!("open at {} Hz", running.sample_rate);
        assert!(running.send(Command::Metronome(true)));
        assert!(running.send(Command::Play {
            from: 0.0,
            count_in_beats: 0.0
        }));
        std::thread::sleep(std::time::Duration::from_millis(1000));
        let pos = running.status.position();
        eprintln!(
            "position after a second: {pos:.3} s, load {:.3}, errors {}",
            running.status.load(),
            running.status.errors()
        );
        assert!(pos > 0.5, "the transport moved {pos}");
    }
}
