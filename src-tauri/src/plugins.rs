//! The VST3 and CLAP plugins on this computer, for the studio's browser
//! (`src/engine/native/plugins.ts`): found by a scan of the standard
//! folders and any the user adds (crates/dawn-plugins), which runs in the
//! background, each file read by this program run as
//! `--scan-plugin <format> <path>` (main.rs). What it finds is kept in the
//! app's data folder, so the next scan only reads what changed.

use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

use dawn_plugins::scan::{Cache, Progress, Scanner};
use dawn_plugins::{Format, PluginInfo, folders};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

/// The scan's cache, in the app's data folder.
const CACHE_FILE: &str = "plugins.json";
/// The folders the user added, beside it.
const FOLDERS_FILE: &str = "plugin-folders.json";

#[derive(Default)]
struct Inner {
    /// Read from the data folder on first use.
    loaded: bool,
    cache: Cache,
    /// The folders the user added, searched after the standard ones.
    added: Vec<PathBuf>,
    /// How the scan running now is going.
    scanning: Option<Progress>,
    /// A scan asked for while one was running, to run after it (and
    /// whether it retries the files that failed).
    queued: Option<bool>,
    /// Whether a scan has finished since the app started.
    scanned: bool,
}

/// The plugins' state in the app (Tauri's managed state).
#[derive(Default, Clone)]
pub struct PluginsState(Arc<Mutex<Inner>>);

impl PluginsState {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

fn data_folder(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("The app's data folder isn't known ({e})."))
}

fn load(app: &AppHandle, inner: &mut Inner) {
    if inner.loaded {
        return;
    }
    inner.loaded = true;
    if let Ok(folder) = data_folder(app) {
        inner.cache = Cache::read(&folder.join(CACHE_FILE));
        inner.added = std::fs::read(folder.join(FOLDERS_FILE))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
    }
}

fn save_folders(app: &AppHandle, added: &[PathBuf]) -> Result<(), String> {
    let folder = data_folder(app)?;
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let json = serde_json::to_vec_pretty(added).map_err(|e| e.to_string())?;
    std::fs::write(folder.join(FOLDERS_FILE), json).map_err(|e| e.to_string())
}

/// Every folder searched: the standard ones, then the user's.
fn all_folders(added: &[PathBuf]) -> Vec<PathBuf> {
    let mut all = folders::standard();
    for folder in added {
        if !all.contains(folder) {
            all.push(folder.clone());
        }
    }
    all
}

/// Starts a scan in the background, or queues one after the scan running.
fn start_scan(app: &AppHandle, state: &PluginsState, retry_failed: bool) {
    let mut inner = state.lock();
    load(app, &mut inner);
    if inner.scanning.is_some() {
        inner.queued = Some(inner.queued.unwrap_or(false) || retry_failed);
        return;
    }
    inner.scanning = Some(Progress::default());
    drop(inner);

    let app = app.clone();
    let shared = state.clone();
    let spawned = std::thread::Builder::new()
        .name("dawn-plugin-scan".into())
        .spawn(move || {
            let state = shared;
            let mut retry = retry_failed;
            loop {
                let (folders, cache) = {
                    let inner = state.lock();
                    (all_folders(&inner.added), inner.cache.clone())
                };
                let scanned = match Scanner::this_program() {
                    Ok(scanner) => scanner.scan(&folders, &cache, retry, &|progress| {
                        state.lock().scanning = Some(progress.clone());
                    }),
                    Err(_) => cache,
                };
                if let Ok(folder) = data_folder(&app) {
                    let _ = scanned.write(&folder.join(CACHE_FILE));
                }
                let mut inner = state.lock();
                inner.cache = scanned;
                inner.scanned = true;
                match inner.queued.take() {
                    Some(again) => {
                        retry = again;
                        inner.scanning = Some(Progress::default());
                    }
                    None => {
                        inner.scanning = None;
                        return;
                    }
                }
            }
        });
    if spawned.is_err() {
        state.lock().scanning = None;
    }
}

/// A plugin file that couldn't be read, and why.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    format: Format,
    path: PathBuf,
    error: String,
}

/// A folder searched for plugins.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo {
    path: PathBuf,
    /// One of this system's standard folders (otherwise, one the user
    /// added, which can be taken off the list).
    standard: bool,
    exists: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginList {
    plugins: Vec<PluginInfo>,
    failed: Vec<Failure>,
    folders: Vec<FolderInfo>,
    /// How the scan running now is going, if one is.
    scan: Option<Progress>,
    /// Whether a scan has finished since the app started (until then, the
    /// list is the last one's).
    scanned: bool,
}

/// The plugins found so far, and how the scan is going. The first call
/// starts a scan, so the list is kept up to date with what's installed.
#[tauri::command]
pub fn plugins_list(app: AppHandle, state: State<'_, PluginsState>) -> PluginList {
    let first = {
        let mut inner = state.lock();
        let first = !inner.loaded;
        load(&app, &mut inner);
        first
    };
    if first {
        start_scan(&app, &state, false);
    }
    let inner = state.lock();
    let standard = folders::standard();
    PluginList {
        plugins: inner.cache.plugins(),
        failed: inner
            .cache
            .failures()
            .map(|f| Failure {
                format: f.format,
                path: f.path.clone(),
                error: f.error.clone().unwrap_or_default(),
            })
            .collect(),
        folders: all_folders(&inner.added)
            .into_iter()
            .map(|path| FolderInfo {
                standard: standard.contains(&path),
                exists: path.is_dir(),
                path,
            })
            .collect(),
        scan: inner.scanning.clone(),
        scanned: inner.scanned,
    }
}

/// Scans the folders again: for plugins installed or changed since, and
/// (with `retry_failed`) the files that couldn't be read before.
#[tauri::command]
pub fn plugins_scan(app: AppHandle, state: State<'_, PluginsState>, retry_failed: bool) {
    start_scan(&app, &state, retry_failed);
}

/// Adds a folder to search, and scans it.
#[tauri::command]
pub fn plugins_add_folder(
    app: AppHandle,
    state: State<'_, PluginsState>,
    path: String,
) -> Result<(), String> {
    // As typed (canonicalizing would turn a Windows path into \\?\ form).
    let path = PathBuf::from(path.trim());
    if !path.is_dir() {
        return Err("There's no folder there.".into());
    }
    {
        let mut inner = state.lock();
        load(&app, &mut inner);
        if all_folders(&inner.added).contains(&path) {
            return Ok(());
        }
        inner.added.push(path);
        save_folders(&app, &inner.added)?;
    }
    start_scan(&app, &state, false);
    Ok(())
}

/// Stops searching a folder the user added (its plugins go from the list
/// with the next scan, which this starts).
#[tauri::command]
pub fn plugins_remove_folder(
    app: AppHandle,
    state: State<'_, PluginsState>,
    path: String,
) -> Result<(), String> {
    {
        let mut inner = state.lock();
        load(&app, &mut inner);
        let path = PathBuf::from(path);
        inner.added.retain(|f| f != &path);
        save_folders(&app, &inner.added)?;
    }
    start_scan(&app, &state, false);
    Ok(())
}
