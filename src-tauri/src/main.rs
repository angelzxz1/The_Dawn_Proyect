// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() -> std::process::ExitCode {
    // The plugin scan runs the app again to read each plugin file, in a
    // process of its own (src/plugins.rs).
    if let Some(exit) = dawn_desktop_lib::scan_plugin(std::env::args_os()) {
        return exit;
    }
    dawn_desktop_lib::run();
    std::process::ExitCode::SUCCESS
}
