//! The Dawn Project's desktop app: the studio (the web app's static export
//! in `out/`, opened at `/app`) in a native window, and the bridge to the
//! native engine (crates/dawn-engine) as it takes over from Web Audio. See
//! docs/desktop.md.

use tauri::Webview;
use tauri::webview::{PermissionKind, PermissionResponse};

/// What the studio can learn about the native engine
/// (`invoke("engine_info")`).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineInfo {
    version: &'static str,
    /// The effects whose kernels have been ported to Rust.
    ported_effects: &'static [&'static str],
}

#[tauri::command]
fn engine_info() -> EngineInfo {
    EngineInfo {
        version: dawn_engine::VERSION,
        ported_effects: dawn_engine::effects::PORTED,
    }
}

/// Whether a webview is showing the studio itself (the bundled app, or the
/// dev server in a debug build) rather than a site it was sent to.
fn is_app_page(webview: &Webview) -> bool {
    let Ok(url) = webview.url() else {
        return false;
    };
    let place = (url.scheme(), url.host_str());
    let bundled = matches!(
        place,
        ("tauri", _) | ("http" | "https", Some("tauri.localhost"))
    );
    let dev_server =
        cfg!(debug_assertions) && matches!(place, ("http", Some("localhost" | "127.0.0.1")));
    bundled || dev_server
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // The studio records from the audio interface and plays from MIDI
        // controllers: the app's own pages get those without the webview
        // asking on every launch (the system may still ask once, like
        // macOS's microphone prompt).
        .on_permission_request(|webview, kind| match kind {
            PermissionKind::Microphone | PermissionKind::Midi if is_app_page(&webview) => {
                PermissionResponse::Allow
            }
            _ => PermissionResponse::Default,
        })
        .invoke_handler(tauri::generate_handler![engine_info])
        .run(tauri::generate_context!())
        .expect("error while running the Dawn desktop app");
}
