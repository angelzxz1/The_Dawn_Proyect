//! The scan against real plugins: dawn-test-plugin's library, built here
//! and laid out the way this system keeps VST3 bundles and CLAP files,
//! plus a bundle that's only its moduleinfo.json, and two CLAP files that
//! crash and hang as they load. Each file is read by the scan's own
//! program (src/bin/dawn-plugin-scan.rs), in a process of its own.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime};

use dawn_plugins::scan::{Cache, Scanner};
use dawn_plugins::{Format, Kind, PluginInfo};

const GAIN_ID: &str = "444157444E544553544741494E000001";
const TONE_ID: &str = "444157444E54455354544F4E45000001";

/// dawn-test-plugin's library, built (once) in a target folder of its
/// own, so this doesn't wait on the build running the tests.
fn test_plugin() -> &'static Path {
    static BUILT: OnceLock<PathBuf> = OnceLock::new();
    BUILT.get_or_init(|| {
        let workspace = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let target = workspace.join("target").join("test-plugin");
        let status = Command::new(env!("CARGO"))
            .args(["build", "--quiet", "-p", "dawn-test-plugin", "--target-dir"])
            .arg(&target)
            .current_dir(&workspace)
            .status()
            .expect("cargo runs");
        assert!(status.success(), "dawn-test-plugin builds");
        let name = format!(
            "{}dawn_test_plugin{}",
            std::env::consts::DLL_PREFIX,
            std::env::consts::DLL_SUFFIX
        );
        target.join("debug").join(name)
    })
}

fn info_plist(bundle: &Path, executable: &str) {
    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>{executable}</string>
<key>CFBundleIdentifier</key><string>com.dawn-project.test.{}</string>
<key>CFBundlePackageType</key><string>BNDL</string>
</dict></plist>
"#,
        executable.replace(' ', "-").to_lowercase()
    );
    std::fs::write(bundle.join("Contents").join("Info.plist"), plist).unwrap();
}

/// Lays the library out as a VST3 bundle named `name`.
fn vst3_bundle(folder: &Path, name: &str) -> PathBuf {
    let bundle = folder.join(format!("{name}.vst3"));
    let (arch, file) = match std::env::consts::OS {
        "windows" => ("x86_64-win".to_owned(), format!("{name}.vst3")),
        "macos" => ("MacOS".to_owned(), name.to_owned()),
        _ => (
            format!("{}-linux", std::env::consts::ARCH),
            format!("{name}.so"),
        ),
    };
    let binary_folder = bundle.join("Contents").join(arch);
    std::fs::create_dir_all(&binary_folder).unwrap();
    std::fs::copy(test_plugin(), binary_folder.join(file)).unwrap();
    if cfg!(target_os = "macos") {
        info_plist(&bundle, name);
    }
    bundle
}

/// Lays the library out as a CLAP file (a bundle, on macOS) named `name`.
fn clap_file(folder: &Path, name: &str) -> PathBuf {
    let path = folder.join(format!("{name}.clap"));
    if cfg!(target_os = "macos") {
        let binary_folder = path.join("Contents").join("MacOS");
        std::fs::create_dir_all(&binary_folder).unwrap();
        std::fs::copy(test_plugin(), binary_folder.join(name)).unwrap();
        info_plist(&path, name);
    } else {
        std::fs::copy(test_plugin(), &path).unwrap();
    }
    path
}

fn scanner() -> Scanner {
    Scanner {
        program: PathBuf::from(env!("CARGO_BIN_EXE_dawn-plugin-scan")),
        args: Vec::new(),
        timeout: Duration::from_secs(5),
        jobs: 3,
    }
}

/// A scanner that can't read anything: a scan with it shows what was
/// taken from the cache.
fn broken_scanner() -> Scanner {
    Scanner {
        program: PathBuf::from("/there/is/no/such/program"),
        ..scanner()
    }
}

#[test]
fn finds_the_plugins_and_says_which_files_failed() {
    let root = std::env::temp_dir().join(format!("dawn-scan-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let vst3 = root.join("VST3");
    let clap = root.join("CLAP").join("Vendor");
    std::fs::create_dir_all(&vst3).unwrap();
    std::fs::create_dir_all(&clap).unwrap();

    let vst3_path = vst3_bundle(&vst3, "Dawn Test");
    // A bundle whose moduleinfo.json says what's in it: read from that,
    // without loading anything (it has no binary at all).
    let info = vst3.join("Dawn Info.vst3");
    std::fs::create_dir_all(info.join("Contents").join("Resources")).unwrap();
    std::fs::write(
        info.join("Contents").join("Resources").join("moduleinfo.json"),
        r#"{ "Name": "Dawn Info", "Version": "2.0.0", "Factory Info": { "Vendor": "Info Audio", },
             "Classes": [ { "CID": "00000000000000000000000000000ABC", "Category": "Audio Module Class",
                            "Name": "Dawn Info Reverb", "Sub Categories": [ "Fx|Reverb" ], }, ], }"#,
    )
    .unwrap();
    let clap_path = clap_file(&clap, "Dawn Test");
    let crashes = clap_file(&clap, "Dawn Crashes");
    let hangs = clap_file(&clap, "Dawn Hangs");

    let progress = std::sync::Mutex::new(Vec::new());
    let folders = [root.join("VST3"), root.join("CLAP"), root.join("Missing")];
    let started = std::time::Instant::now();
    let cache = scanner().scan(&folders, &Cache::default(), false, &|p| {
        progress.lock().unwrap().push(p.clone())
    });
    // The hanging one was stopped at the timeout, not waited out.
    assert!(started.elapsed() < Duration::from_secs(30));

    let plugin =
        |format, id: &str, name: &str, kind, categories: &[&str], path: &Path| PluginInfo {
            format,
            id: id.into(),
            name: name.into(),
            vendor: "The Dawn Project".into(),
            version: "1.0.0".into(),
            kind,
            categories: categories.iter().map(|c| c.to_string()).collect(),
            path: path.to_owned(),
        };
    let mut expected = vec![
        plugin(
            Format::Vst3,
            GAIN_ID,
            "Dawn Test Gain",
            Kind::Effect,
            &["Fx"],
            &vst3_path,
        ),
        plugin(
            Format::Clap,
            "com.dawn-project.test.gain",
            "Dawn Test Gain",
            Kind::Effect,
            &["audio-effect", "stereo"],
            &clap_path,
        ),
        plugin(
            Format::Vst3,
            TONE_ID,
            "Dawn Test Tone",
            Kind::Instrument,
            &["Instrument", "Synth"],
            &vst3_path,
        ),
        plugin(
            Format::Clap,
            "com.dawn-project.test.tone",
            "Dawn Test Tone",
            Kind::Instrument,
            &["instrument", "synthesizer", "stereo"],
            &clap_path,
        ),
    ];
    expected.insert(
        0,
        PluginInfo {
            format: Format::Vst3,
            id: "00000000000000000000000000000ABC".into(),
            name: "Dawn Info Reverb".into(),
            vendor: "Info Audio".into(),
            version: "2.0.0".into(),
            kind: Kind::Effect,
            categories: vec!["Fx".into(), "Reverb".into()],
            path: info.clone(),
        },
    );
    assert_eq!(cache.plugins(), expected);

    let failures: Vec<_> = cache
        .failures()
        .map(|f| (f.path.clone(), f.error.clone().unwrap()))
        .collect();
    assert_eq!(
        failures,
        [
            (crashes.clone(), "It crashed as it loaded.".to_owned()),
            (
                hangs.clone(),
                "It took more than 5 seconds to load, so it was stopped.".to_owned()
            ),
        ]
    );

    let progress = progress.into_inner().unwrap();
    let last = progress.last().unwrap();
    assert_eq!((last.done, last.total), (5, 5));
    assert!(last.reading.is_empty());
    assert!(progress.iter().any(|p| p.reading.contains(&hangs)));

    // The cache round-trips through its file.
    let file = root.join("cache").join("plugins.json");
    cache.write(&file).unwrap();
    let cache = Cache::read(&file);

    // Scanned again: nothing changed, so nothing's read (this scanner
    // can't), and the failures stay failures...
    let again = broken_scanner().scan(&folders, &cache, false, &|_| {});
    assert_eq!(again, cache);

    // ...until they're tried again. Those are read again (and fail
    // differently, with this scanner); the rest still aren't.
    let retried = broken_scanner().scan(&folders, &cache, true, &|_| {});
    assert_eq!(retried.plugins(), cache.plugins());
    assert!(retried.failures().all(|f| {
        f.error
            .as_deref()
            .unwrap()
            .starts_with("The scan couldn't start")
    }));

    // A file that changed is read again; one that's gone is dropped.
    let binary = if cfg!(target_os = "macos") {
        clap_path.join("Contents").join("MacOS").join("Dawn Test")
    } else {
        clap_path.clone()
    };
    std::fs::File::options()
        .write(true)
        .open(&binary)
        .unwrap()
        .set_modified(SystemTime::now() + Duration::from_secs(60))
        .unwrap();
    std::fs::remove_dir_all(&info).unwrap();
    let changed = broken_scanner().scan(&folders, &cache, false, &|_| {});
    let names: Vec<_> = changed
        .plugins()
        .into_iter()
        .map(|p| (p.format, p.name))
        .collect();
    assert_eq!(
        names,
        [
            (Format::Vst3, "Dawn Test Gain".to_owned()),
            (Format::Vst3, "Dawn Test Tone".to_owned()),
        ]
    );
    assert_eq!(changed.failures().count(), 3);

    std::fs::remove_dir_all(&root).unwrap();
}
