//! Reading a CLAP plugin file: its entry's plugin factory lists each
//! plugin in it, with its features ("instrument", "audio-effect").

use std::ffi::CStr;
use std::path::Path;

use clack_host::prelude::PluginEntry;

use crate::{Format, Kind, PluginInfo};

/// What the features say a plugin is: an instrument, a note effect, or
/// (for audio effects, analyzers and anything else) an effect.
pub fn kind_of(features: &[String]) -> Kind {
    let has = |f: &str| features.iter().any(|x| x.eq_ignore_ascii_case(f));
    if has("instrument") {
        Kind::Instrument
    } else if has("note-effect") && !has("audio-effect") {
        Kind::NoteEffect
    } else {
        Kind::Effect
    }
}

fn text(field: Option<&CStr>) -> String {
    field
        .map(|t| t.to_string_lossy().trim().to_owned())
        .unwrap_or_default()
}

/// Loads the file's entry and reads its factory, in this process. The
/// scanner does that in a process of its own (`scan::child_main`), in case
/// the plugin crashes.
///
/// # Safety
/// This runs the plugin's own code, which can do anything.
pub unsafe fn load(path: &Path) -> Result<Vec<PluginInfo>, String> {
    let entry =
        unsafe { PluginEntry::load(path) }.map_err(|e| format!("It couldn't be loaded ({e})."))?;
    let factory = entry
        .get_plugin_factory()
        .ok_or("It has no plugin factory.")?;
    let mut plugins = Vec::new();
    for descriptor in factory.plugin_descriptors() {
        let id = text(descriptor.id());
        if id.is_empty() {
            continue;
        }
        let categories: Vec<String> = descriptor
            .features()
            .map(|f| f.to_string_lossy().into_owned())
            .collect();
        plugins.push(PluginInfo {
            format: Format::Clap,
            name: Some(text(descriptor.name()))
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| id.clone()),
            id,
            vendor: text(descriptor.vendor()),
            version: text(descriptor.version()),
            kind: kind_of(&categories),
            categories,
            path: path.to_owned(),
        });
    }
    Ok(plugins)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn features_say_what_a_plugin_is() {
        let kind = |f: &[&str]| kind_of(&f.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        assert_eq!(
            kind(&["instrument", "synthesizer", "stereo"]),
            Kind::Instrument
        );
        assert_eq!(kind(&["audio-effect", "delay"]), Kind::Effect);
        assert_eq!(kind(&["analyzer"]), Kind::Effect);
        assert_eq!(kind(&["note-effect", "arpeggiator"]), Kind::NoteEffect);
        assert_eq!(kind(&[]), Kind::Effect);
    }
}
