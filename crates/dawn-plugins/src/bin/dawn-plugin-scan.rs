//! The plugin scan's own process, on its own, for the tests (the desktop
//! app runs itself for this: src-tauri/src/main.rs).

fn main() -> std::process::ExitCode {
    dawn_plugins::scan::child_main(std::env::args_os()).unwrap_or_else(|| {
        eprintln!("usage: dawn-plugin-scan --scan-plugin <vst3|clap> <path>");
        std::process::ExitCode::from(2)
    })
}
