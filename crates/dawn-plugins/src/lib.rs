//! Hosting VST3 and CLAP plugins in Dawn's desktop app.
//!
//! So far it finds them: `folders` lists the places each system keeps
//! them and finds the plugin files there, `vst3` and `clap` read what's in
//! a file (its plugins' names, makers and whether each is an effect or an
//! instrument), and `scan` does that for every file, each one loaded in a
//! process of its own (`child_main`), so a plugin that crashes or hangs as
//! it loads takes only that process with it. What a scan finds is cached
//! by each file's size and time, so the next one only reads what changed.
//!
//! Running them in the native engine comes next (docs/desktop.md).

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub mod clap;
pub mod folders;
pub mod scan;
pub mod vst3;

/// A plugin format.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Vst3,
    Clap,
}

impl Format {
    /// As the scan's command line and the cache spell it.
    pub fn as_str(self) -> &'static str {
        match self {
            Format::Vst3 => "vst3",
            Format::Clap => "clap",
        }
    }

    pub fn parse(text: &str) -> Option<Format> {
        match text {
            "vst3" => Some(Format::Vst3),
            "clap" => Some(Format::Clap),
            _ => None,
        }
    }

    /// The file (or bundle) extension, without the dot.
    pub fn extension(self) -> &'static str {
        self.as_str()
    }
}

/// What a plugin is for.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    /// Takes audio and gives audio back (including analyzers).
    Effect,
    /// Plays notes.
    Instrument,
    /// Takes notes and gives notes back (an arpeggiator, say).
    NoteEffect,
}

/// One plugin, as a scan found it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub format: Format,
    /// What the plugin is known by in its format: a VST3 class id (32 hex
    /// digits) or a CLAP plugin id ("com.vendor.name"). With the format,
    /// what a project will refer to it by.
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub version: String,
    pub kind: Kind,
    /// Its VST3 sub-categories ("Fx", "Delay") or CLAP features
    /// ("audio-effect", "delay").
    pub categories: Vec<String>,
    /// The file or bundle it's in.
    pub path: PathBuf,
}
