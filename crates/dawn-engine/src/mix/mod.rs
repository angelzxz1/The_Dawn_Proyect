//! The engine that plays the song: the transport, the clips, the
//! instruments, the mix with its effects and the master, and the metronome. The studio describes the song
//! (`song::Song`), and the engine renders it to whatever asks for samples:
//! an audio interface (the desktop app, `src-tauri`) or a file.

pub mod clip;
pub mod engine;
pub mod fx;
pub mod latency;
pub mod metronome;
pub mod player;
pub mod song;
pub mod tempo;

pub use clip::{AudioData, Clip, ClipTiming};
pub use engine::Engine;
pub use fx::{EffectKind, EffectSettings, EffectSpec};
pub use player::{InstrumentKind, InstrumentSpec, Note, track_key};
pub use song::{Bus, Destination, MAX_BLOCK, Master, Prepared, Send, Song, Track, db_to_gain};
