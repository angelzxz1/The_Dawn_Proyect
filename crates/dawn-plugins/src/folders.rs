//! Where each system keeps plugins, and finding the plugin files there.

use std::collections::HashSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::Format;

/// A plugin file (or bundle) found in a folder, not read yet.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Candidate {
    pub format: Format,
    pub path: PathBuf,
}

/// The folders this system keeps VST3 and CLAP plugins in, as the formats
/// define them: the user's own first, then the system's, with CLAP_PATH's
/// folders ahead of all.
pub fn standard() -> Vec<PathBuf> {
    standard_for(std::env::consts::OS, |name| std::env::var_os(name))
}

/// `standard`, for a given system (`std::env::consts::OS`) and
/// environment.
pub fn standard_for(os: &str, env: impl Fn(&str) -> Option<OsString>) -> Vec<PathBuf> {
    let mut folders = Vec::new();
    if let Some(clap_path) = env("CLAP_PATH") {
        let separator = if os == "windows" { ';' } else { ':' };
        folders.extend(
            clap_path
                .to_string_lossy()
                .split(separator)
                .filter(|p| !p.is_empty())
                .map(PathBuf::from),
        );
    }
    let home = env("HOME").map(PathBuf::from);
    match os {
        "windows" => {
            // FOLDERID_UserProgramFilesCommon and FOLDERID_ProgramFilesCommon.
            if let Some(local) = env("LOCALAPPDATA") {
                let common = PathBuf::from(local).join("Programs").join("Common");
                folders.push(common.join("VST3"));
                folders.push(common.join("CLAP"));
            }
            let common = env("CommonProgramW6432")
                .or_else(|| env("CommonProgramFiles"))
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(r"C:\Program Files\Common Files"));
            folders.push(common.join("VST3"));
            folders.push(common.join("CLAP"));
        }
        "macos" => {
            for root in home.iter().chain([&PathBuf::from("/")]) {
                let plug_ins = root.join("Library").join("Audio").join("Plug-Ins");
                folders.push(plug_ins.join("VST3"));
                folders.push(plug_ins.join("CLAP"));
            }
        }
        _ => {
            if let Some(home) = &home {
                folders.push(home.join(".vst3"));
                folders.push(home.join(".clap"));
            }
            folders.push(PathBuf::from("/usr/lib/vst3"));
            folders.push(PathBuf::from("/usr/local/lib/vst3"));
            folders.push(PathBuf::from("/usr/lib/clap"));
        }
    }
    let mut seen = HashSet::new();
    folders.retain(|f| seen.insert(f.clone()));
    folders
}

/// How deep `find` looks into a folder's sub-folders (vendors keep theirs
/// in folders of their own).
const MAX_DEPTH: usize = 8;

fn format_of(name: &str) -> Option<Format> {
    let (_, extension) = name.rsplit_once('.')?;
    [Format::Vst3, Format::Clap]
        .into_iter()
        .find(|f| extension.eq_ignore_ascii_case(f.extension()))
}

/// The plugin files and bundles in the folders and their sub-folders, each
/// once (sorted, by format then path). A missing folder has none.
pub fn find(folders: &[PathBuf]) -> Vec<Candidate> {
    let mut found = Vec::new();
    // Real paths seen, so a link back up a folder isn't followed forever
    // and a plugin reached two ways is only listed once.
    let mut seen = HashSet::new();
    for folder in folders {
        walk(folder, 0, &mut seen, &mut found);
    }
    found.sort();
    found
}

fn walk(folder: &Path, depth: usize, seen: &mut HashSet<PathBuf>, found: &mut Vec<Candidate>) {
    let Ok(real) = folder.canonicalize() else {
        return;
    };
    if !seen.insert(real) {
        return;
    }
    let Ok(entries) = std::fs::read_dir(folder) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().map(|e| e.path()).collect();
    entries.sort();
    for path in entries {
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if let Some(format) = format_of(name) {
            if let Ok(real) = path.canonicalize()
                && seen.insert(real)
            {
                found.push(Candidate { format, path });
            }
        } else if depth < MAX_DEPTH && !name.starts_with('.') && path.is_dir() {
            walk(&path, depth + 1, seen, found);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env<'a>(vars: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<OsString> + 'a {
        |name| {
            vars.iter()
                .find(|(n, _)| *n == name)
                .map(|(_, v)| OsString::from(v))
        }
    }

    #[test]
    fn each_system_has_its_folders() {
        let windows = standard_for(
            "windows",
            env(&[
                ("LOCALAPPDATA", r"C:\Users\ana\AppData\Local"),
                ("CommonProgramFiles", r"D:\Common Files"),
            ]),
        );
        let windows: Vec<_> = windows
            .iter()
            .map(|p| p.to_string_lossy().replace('/', "\\"))
            .collect();
        assert_eq!(
            windows,
            [
                r"C:\Users\ana\AppData\Local\Programs\Common\VST3",
                r"C:\Users\ana\AppData\Local\Programs\Common\CLAP",
                r"D:\Common Files\VST3",
                r"D:\Common Files\CLAP",
            ]
        );

        let mac = standard_for("macos", env(&[("HOME", "/Users/ana")]));
        assert_eq!(
            mac,
            [
                "/Users/ana/Library/Audio/Plug-Ins/VST3",
                "/Users/ana/Library/Audio/Plug-Ins/CLAP",
                "/Library/Audio/Plug-Ins/VST3",
                "/Library/Audio/Plug-Ins/CLAP",
            ]
            .map(PathBuf::from)
        );

        let linux = standard_for(
            "linux",
            env(&[
                ("HOME", "/home/ana"),
                ("CLAP_PATH", "/opt/clap::/home/ana/.clap"),
            ]),
        );
        assert_eq!(
            linux,
            [
                "/opt/clap",
                "/home/ana/.clap",
                "/home/ana/.vst3",
                "/usr/lib/vst3",
                "/usr/local/lib/vst3",
                "/usr/lib/clap",
            ]
            .map(PathBuf::from)
        );
    }

    #[test]
    fn finds_the_plugins_in_folders_and_their_sub_folders() {
        let root = std::env::temp_dir().join(format!("dawn-find-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let vst3 = root.join("VST3");
        let clap = root.join("CLAP");
        for dir in [
            vst3.join("Vendor/Reverb.vst3/Contents/x86_64-linux"),
            vst3.join("Delay.VST3/Contents/Resources"),
            vst3.join("Docs"),
            clap.join("Synth.clap/Contents/MacOS"),
        ] {
            std::fs::create_dir_all(dir).unwrap();
        }
        std::fs::write(vst3.join("Old.vst3"), b"").unwrap();
        std::fs::write(vst3.join("Docs/readme.txt"), b"").unwrap();
        std::fs::write(clap.join("Filter.clap"), b"").unwrap();
        std::fs::write(clap.join("notes.so"), b"").unwrap();
        #[cfg(unix)]
        {
            // A link back up the tree, and a second way to the same plugin.
            std::os::unix::fs::symlink(&vst3, vst3.join("Docs/up")).unwrap();
            std::os::unix::fs::symlink(clap.join("Filter.clap"), clap.join("Twin.clap")).unwrap();
        }

        let found = find(&[vst3.clone(), clap.clone(), root.join("Missing")]);
        let found: Vec<_> = found
            .iter()
            .map(|c| (c.format, c.path.strip_prefix(&root).unwrap().to_owned()))
            .collect();
        assert_eq!(
            found,
            [
                (Format::Vst3, PathBuf::from("VST3/Delay.VST3")),
                (Format::Vst3, PathBuf::from("VST3/Old.vst3")),
                (Format::Vst3, PathBuf::from("VST3/Vendor/Reverb.vst3")),
                (Format::Clap, PathBuf::from("CLAP/Filter.clap")),
                (Format::Clap, PathBuf::from("CLAP/Synth.clap")),
            ]
        );
        std::fs::remove_dir_all(&root).unwrap();
    }
}
