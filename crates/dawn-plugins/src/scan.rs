//! Scanning: every plugin file in the folders read, each in a process of
//! its own, and what was found kept in a cache.
//!
//! The scanning program runs itself (or the program it's given) as
//! `<program> --scan-plugin <format> <path>` for each file; `child_main`
//! is that side. A plugin that crashes as it loads takes only that process
//! with it, and one that never finishes loading is stopped after a while;
//! either way, the scan carries on and says what happened. A VST3 bundle
//! with a moduleinfo.json is read from that, without loading it at all.

use std::ffi::OsString;
use std::io::{BufRead, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::folders::{self, Candidate};
use crate::{Format, PluginInfo, vst3};

/// The scan's command-line flag: `--scan-plugin <format> <path>`.
pub const SCAN_FLAG: &str = "--scan-plugin";

/// Starts the line the scan's process writes what it found on (a plugin
/// may write its own lines too).
const REPORT: &str = "dawn-scan:";

/// The cache's layout. A cache written with another is read again from
/// scratch.
pub const CACHE_VERSION: u32 = 1;

/// When a file last changed, as far as the cache is concerned.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Stamp {
    pub size: u64,
    pub modified_ms: u64,
}

/// The file whose size and time say a plugin file changed: its binary,
/// for a bundle.
fn stamp_file(candidate: &Candidate) -> PathBuf {
    let binary = match candidate.format {
        Format::Vst3 => vst3::binary(&candidate.path),
        Format::Clap if candidate.path.is_dir() => {
            std::fs::read_dir(candidate.path.join("Contents").join("MacOS"))
                .ok()
                .and_then(|dir| dir.flatten().map(|e| e.path()).find(|p| p.is_file()))
        }
        Format::Clap => None,
    };
    binary.unwrap_or_else(|| candidate.path.clone())
}

pub fn stamp(candidate: &Candidate) -> Option<Stamp> {
    let meta = std::fs::metadata(stamp_file(candidate)).ok()?;
    let modified = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    Some(Stamp {
        size: meta.len(),
        modified_ms: modified.as_millis() as u64,
    })
}

/// One plugin file, read: the plugins in it, or why it couldn't be.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Scanned {
    pub format: Format,
    pub path: PathBuf,
    pub stamp: Option<Stamp>,
    #[serde(default)]
    pub plugins: Vec<PluginInfo>,
    #[serde(default)]
    pub error: Option<String>,
}

/// What every scan so far found, by file.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Cache {
    pub version: u32,
    pub files: Vec<Scanned>,
}

impl Cache {
    /// The cache in a file, or an empty one if there's none (or it can't
    /// be read, or is from another version).
    pub fn read(path: &Path) -> Cache {
        std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Cache>(&bytes).ok())
            .filter(|cache| cache.version == CACHE_VERSION)
            .unwrap_or_default()
    }

    /// Writes the cache to a file (by way of a temporary one beside it, so
    /// a crash can't leave half of it).
    pub fn write(&self, path: &Path) -> std::io::Result<()> {
        if let Some(folder) = path.parent() {
            std::fs::create_dir_all(folder)?;
        }
        let temporary = path.with_extension("json.tmp");
        std::fs::write(&temporary, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(&temporary, path)
    }

    /// Every plugin found, by name; one found in two places (the same
    /// format and id), once.
    pub fn plugins(&self) -> Vec<PluginInfo> {
        let mut seen = std::collections::HashSet::new();
        let mut plugins: Vec<PluginInfo> = self
            .files
            .iter()
            .flat_map(|f| &f.plugins)
            .filter(|p| seen.insert((p.format, p.id.clone())))
            .cloned()
            .collect();
        plugins.sort_by_cached_key(|p| (p.name.to_lowercase(), p.format, p.path.clone()));
        plugins
    }

    /// The files that couldn't be read.
    pub fn failures(&self) -> impl Iterator<Item = &Scanned> {
        self.files.iter().filter(|f| f.error.is_some())
    }
}

/// How far a scan has got.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// Files read (or found unchanged) so far, of `total`.
    pub done: usize,
    pub total: usize,
    /// The files being read right now.
    pub reading: Vec<PathBuf>,
}

/// Reads plugin files, each in a process of its own.
#[derive(Clone, Debug)]
pub struct Scanner {
    /// The program that reads a file when run with `args`, then
    /// `--scan-plugin <format> <path>`: one whose main calls `child_main`.
    pub program: PathBuf,
    pub args: Vec<OsString>,
    /// How long a plugin gets to load before its process is stopped.
    pub timeout: Duration,
    /// How many files are read at once.
    pub jobs: usize,
}

impl Scanner {
    /// A scanner that runs the program it's in.
    pub fn this_program() -> std::io::Result<Scanner> {
        Ok(Scanner {
            program: std::env::current_exe()?,
            args: Vec::new(),
            timeout: Duration::from_secs(60),
            jobs: std::thread::available_parallelism()
                .map_or(2, |n| n.get())
                .clamp(1, 4),
        })
    }

    /// Scans the folders. A file the cache has, unchanged, isn't read
    /// again, unless it couldn't be read before and `retry_failed` is set;
    /// one that's gone is dropped. `progress` hears how it's going.
    pub fn scan(
        &self,
        folders: &[PathBuf],
        cache: &Cache,
        retry_failed: bool,
        progress: &(dyn Fn(&Progress) + Sync),
    ) -> Cache {
        let candidates = folders::find(folders);
        let mut files = Vec::new();
        let mut to_read = Vec::new();
        for candidate in candidates {
            let stamp = stamp(&candidate);
            let known = cache.files.iter().find(|f| {
                f.format == candidate.format && f.path == candidate.path && f.stamp == stamp
            });
            match known {
                Some(known) if known.error.is_none() || !retry_failed => files.push(known.clone()),
                _ => to_read.push((candidate, stamp)),
            }
        }

        let state = Mutex::new(Progress {
            done: files.len(),
            total: files.len() + to_read.len(),
            reading: Vec::new(),
        });
        progress(&state.lock().unwrap());
        let next = AtomicUsize::new(0);
        let read = Mutex::new(Vec::new());
        std::thread::scope(|scope| {
            for _ in 0..self.jobs.clamp(1, to_read.len().max(1)) {
                scope.spawn(|| {
                    while let Some((candidate, stamp)) =
                        to_read.get(next.fetch_add(1, Ordering::SeqCst))
                    {
                        {
                            let mut state = state.lock().unwrap();
                            state.reading.push(candidate.path.clone());
                            progress(&state);
                        }
                        let result = self.read(candidate);
                        let (plugins, error) = match result {
                            Ok(plugins) => (plugins, None),
                            Err(error) => (Vec::new(), Some(error)),
                        };
                        read.lock().unwrap().push(Scanned {
                            format: candidate.format,
                            path: candidate.path.clone(),
                            stamp: *stamp,
                            plugins,
                            error,
                        });
                        let mut state = state.lock().unwrap();
                        state.reading.retain(|p| p != &candidate.path);
                        state.done += 1;
                        progress(&state);
                    }
                });
            }
        });
        files.extend(read.into_inner().unwrap());
        files.sort_by(|a, b| (a.format, &a.path).cmp(&(b.format, &b.path)));
        Cache {
            version: CACHE_VERSION,
            files,
        }
    }

    /// Reads one plugin file: a VST3 bundle's moduleinfo.json if it has a
    /// good one, otherwise the file itself, loaded in a process of its own.
    pub fn read(&self, candidate: &Candidate) -> Result<Vec<PluginInfo>, String> {
        if candidate.format == Format::Vst3
            && let Some(Ok(plugins)) = vst3::read_module_info(&candidate.path)
        {
            return Ok(plugins);
        }
        self.read_in_process_of_its_own(candidate)
    }

    fn read_in_process_of_its_own(&self, candidate: &Candidate) -> Result<Vec<PluginInfo>, String> {
        let mut command = Command::new(&self.program);
        command
            .args(&self.args)
            .arg(SCAN_FLAG)
            .arg(candidate.format.as_str())
            .arg(&candidate.path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("The scan couldn't start ({e})."))?;

        // Read as it goes, so a plugin that writes a lot can't fill the
        // pipe and stall; handed over by channel, since a process the
        // plugin started may hold the pipe open after this one is done.
        let mut stdout = child.stdout.take().expect("stdout is piped");
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut output = Vec::new();
            let _ = stdout.read_to_end(&mut output);
            let _ = sender.send(output);
        });

        let deadline = Instant::now() + self.timeout;
        let finished = loop {
            match child.try_wait() {
                Ok(Some(_)) => break true,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(10))
                }
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break false;
                }
            }
        };
        let output = receiver
            .recv_timeout(Duration::from_secs(2))
            .unwrap_or_default();
        if let Some(report) = report_in(&output) {
            return match report.error {
                Some(error) => Err(error),
                None => Ok(report.plugins),
            };
        }
        if finished {
            Err("It crashed as it loaded.".into())
        } else {
            Err(format!(
                "It took more than {} seconds to load, so it was stopped.",
                self.timeout.as_secs()
            ))
        }
    }
}

/// What the scan's process writes: the plugins it found, or why it
/// couldn't.
#[derive(Serialize, Deserialize, Default)]
struct Report {
    #[serde(default)]
    plugins: Vec<PluginInfo>,
    #[serde(default)]
    error: Option<String>,
}

fn report_in(output: &[u8]) -> Option<Report> {
    output
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| line.strip_prefix(REPORT).map(str::to_owned))
        .last()
        .and_then(|json| serde_json::from_str(&json).ok())
}

/// The scan's own process. If the program was run to read a plugin file
/// (`<program> --scan-plugin <format> <path>`), this reads it, writes what
/// it found and returns how to exit; otherwise it returns None, and the
/// program goes on as usual.
pub fn child_main(args: impl IntoIterator<Item = OsString>) -> Option<ExitCode> {
    let args: Vec<OsString> = args.into_iter().collect();
    let at = args.iter().position(|a| a == SCAN_FLAG)?;
    let format = args
        .get(at + 1)
        .and_then(|f| Format::parse(&f.to_string_lossy()));
    let path = args.get(at + 2).map(PathBuf::from);
    let (Some(format), Some(path)) = (format, path) else {
        eprintln!("usage: {SCAN_FLAG} <vst3|clap> <path>");
        return Some(ExitCode::from(2));
    };

    #[cfg(windows)]
    no_error_dialogs();
    #[cfg(target_os = "macos")]
    stay_out_of_the_dock();
    let result = std::panic::catch_unwind(|| match format {
        Format::Vst3 => unsafe { vst3::load(&path) },
        Format::Clap => unsafe { crate::clap::load(&path) },
    });
    let report = match result {
        Ok(Ok(plugins)) => Report {
            plugins,
            error: None,
        },
        Ok(Err(error)) => Report {
            plugins: Vec::new(),
            error: Some(error),
        },
        Err(_) => Report {
            plugins: Vec::new(),
            error: Some("It failed as it loaded.".into()),
        },
    };
    let json = serde_json::to_string(&report).unwrap_or_else(|_| "{}".into());
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "\n{REPORT}{json}");
    let _ = out.flush();
    Some(ExitCode::SUCCESS)
}

/// Keeps Windows from showing a dialog when a plugin crashes, or needs a
/// library that isn't there, as it loads: the scan says so instead.
#[cfg(windows)]
fn no_error_dialogs() {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn SetErrorMode(mode: u32) -> u32;
    }
    const SEM_FAILCRITICALERRORS: u32 = 0x0001;
    const SEM_NOGPFAULTERRORBOX: u32 = 0x0002;
    const SEM_NOOPENFILEERRORBOX: u32 = 0x8000;
    unsafe {
        SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX);
    }
}

/// Keeps the scan's process out of the Dock: a plugin that sets up its
/// user interface as it loads would otherwise put the app's icon there
/// a second time, for a moment.
#[cfg(target_os = "macos")]
fn stay_out_of_the_dock() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
    if let Some(main_thread) = MainThreadMarker::new() {
        NSApplication::sharedApplication(main_thread)
            .setActivationPolicy(NSApplicationActivationPolicy::Prohibited);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_report_among_what_a_plugin_writes() {
        let output = b"loading...\ndawn-scan:{\"error\":\"no\"}\nbye\n";
        assert_eq!(report_in(output).unwrap().error.as_deref(), Some("no"));
        assert!(report_in(b"nothing here").is_none());
    }

    #[test]
    fn a_cache_from_another_version_is_read_as_empty() {
        let dir = std::env::temp_dir().join(format!("dawn-cache-{}", std::process::id()));
        let file = dir.join("plugins.json");
        let cache = Cache {
            version: CACHE_VERSION,
            files: vec![Scanned {
                format: Format::Clap,
                path: "/p/A.clap".into(),
                stamp: Some(Stamp {
                    size: 1,
                    modified_ms: 2,
                }),
                plugins: Vec::new(),
                error: Some("It crashed as it loaded.".into()),
            }],
        };
        cache.write(&file).unwrap();
        assert_eq!(Cache::read(&file), cache);
        std::fs::write(&file, br#"{"version":0,"files":[]}"#).unwrap();
        assert_eq!(Cache::read(&file), Cache::default());
        std::fs::write(&file, b"{").unwrap();
        assert_eq!(Cache::read(&file), Cache::default());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_scan_flag_is_only_taken_with_its_arguments() {
        let args = |a: &[&str]| a.iter().map(OsString::from).collect::<Vec<_>>();
        assert!(child_main(args(&["dawn"])).is_none());
        assert_eq!(
            child_main(args(&["dawn", SCAN_FLAG, "vst2", "/x"])),
            Some(ExitCode::from(2))
        );
    }
}
