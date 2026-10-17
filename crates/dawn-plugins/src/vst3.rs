//! Reading a VST3 module: from the moduleinfo.json in its bundle when it
//! has one (which is written for hosts to read instead of loading the
//! module), or by loading it and asking its factory, as the SDK's hosting
//! code does (public.sdk/source/vst/hosting/module_*.cpp).

use std::ffi::c_char;
#[cfg(unix)]
use std::ffi::c_void;
use std::path::{Path, PathBuf};

use vst3::ComPtr;
use vst3::Steinberg::{
    IPluginFactory, IPluginFactory2, IPluginFactory2Trait, IPluginFactoryTrait, PClassInfo,
    PClassInfo2, PFactoryInfo, TUID, kResultOk,
};

use crate::{Format, Kind, PluginInfo};

/// The category of the classes that are plugins (kVstAudioEffectClass;
/// the others are their controllers and such).
const PLUGIN_CATEGORY: &str = "Audio Module Class";

/// Text from a fixed-size C string field.
fn text(field: &[c_char]) -> String {
    let bytes: Vec<u8> = field
        .iter()
        .take_while(|c| **c != 0)
        .map(|c| *c as u8)
        .collect();
    String::from_utf8_lossy(&bytes).trim().to_owned()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect()
}

/// A class id as the SDK writes it (`VST3::UID::toString`, which is what
/// moduleinfo.json has): on Windows in COM's byte order, so an id reads
/// the same on every system.
pub fn class_id(cid: &TUID) -> String {
    let b = cid.map(|c| c as u8);
    if cfg!(target_os = "windows") {
        let d1 = u32::from_le_bytes([b[0], b[1], b[2], b[3]]);
        let d2 = u16::from_le_bytes([b[4], b[5]]);
        let d3 = u16::from_le_bytes([b[6], b[7]]);
        format!("{d1:08X}{d2:04X}{d3:04X}{}", hex(&b[8..]))
    } else {
        hex(&b)
    }
}

/// An instrument says so in its sub-categories ("Instrument|Synth");
/// everything else is an effect.
pub fn kind_of(sub_categories: &[String]) -> Kind {
    if sub_categories
        .iter()
        .any(|c| c.eq_ignore_ascii_case("Instrument"))
    {
        Kind::Instrument
    } else {
        Kind::Effect
    }
}

fn sub_categories(text: &str) -> Vec<String> {
    text.split('|')
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .map(str::to_owned)
        .collect()
}

/// The folders in a bundle's Contents that may have this system's binary,
/// in the order the SDK tries them.
fn architectures() -> Vec<String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => vec!["x86_64-win".into()],
        ("windows", "aarch64") => vec!["arm64-win".into(), "arm64x-win".into()],
        ("windows", "x86") => vec!["x86-win".into()],
        ("macos", _) => vec!["MacOS".into()],
        (_, "x86") => vec!["i386-linux".into(), "i686-linux".into()],
        (_, arch) => vec![format!("{arch}-linux")],
    }
}

/// The module's binary: in a bundle, the one for this system (named as
/// the bundle is, or the only one there); a single-file module (an older
/// Windows plugin) is its own.
pub fn binary(path: &Path) -> Option<PathBuf> {
    if path.is_file() {
        return Some(path.to_owned());
    }
    let stem = path.file_stem()?;
    let extension = match std::env::consts::OS {
        "windows" => Some("vst3"),
        "macos" => None,
        _ => Some("so"),
    };
    for arch in architectures() {
        let folder = path.join("Contents").join(arch);
        let mut named = folder.join(stem).into_os_string();
        if let Some(e) = extension {
            named.push(".");
            named.push(e);
        }
        let named = PathBuf::from(named);
        if named.is_file() {
            return Some(named);
        }
        let Ok(files) = std::fs::read_dir(&folder) else {
            continue;
        };
        let only = files.flatten().map(|e| e.path()).find(|p| {
            p.is_file()
                && match extension {
                    Some(e) => p.extension().is_some_and(|x| x.eq_ignore_ascii_case(e)),
                    None => true,
                }
        });
        if only.is_some() {
            return only;
        }
    }
    None
}

/// What the bundle's moduleinfo.json says is in it, if it has one.
pub fn read_module_info(bundle: &Path) -> Option<Result<Vec<PluginInfo>, String>> {
    let file = bundle
        .join("Contents")
        .join("Resources")
        .join("moduleinfo.json");
    let text = std::fs::read_to_string(file).ok()?;
    Some(parse_module_info(&text, bundle))
}

/// moduleinfo.json is JSON5: comments and trailing commas are allowed.
/// This takes those out, so it's plain JSON.
fn relaxed(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    let mut in_string = false;
    // The comma waiting to see whether a value follows it.
    let mut comma: Option<usize> = None;
    while i < chars.len() {
        let c = chars[i];
        if in_string {
            out.push(c);
            if c == '\\' && i + 1 < chars.len() {
                out.push(chars[i + 1]);
                i += 1;
            } else if c == '"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        match (c, chars.get(i + 1)) {
            ('/', Some('/')) => {
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
                continue;
            }
            ('/', Some('*')) => {
                i += 2;
                while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                    i += 1;
                }
                i += 2;
                continue;
            }
            _ => {}
        }
        if c.is_whitespace() {
            out.push(c);
        } else {
            if let Some(at) = comma.take()
                && c != '}'
                && c != ']'
            {
                out.insert(at, ',');
            }
            if c == ',' {
                comma = Some(out.len());
            } else {
                out.push(c);
                in_string = c == '"';
            }
        }
        i += 1;
    }
    out
}

/// The plugins a moduleinfo.json lists (its "Audio Module Class" classes).
pub fn parse_module_info(text: &str, bundle: &Path) -> Result<Vec<PluginInfo>, String> {
    let info: serde_json::Value = serde_json::from_str(&relaxed(text))
        .map_err(|e| format!("Its moduleinfo.json couldn't be read ({e})."))?;
    let field = |value: &serde_json::Value, key: &str| -> String {
        value[key].as_str().unwrap_or("").trim().to_owned()
    };
    let factory_vendor = field(&info["Factory Info"], "Vendor");
    let module_version = field(&info, "Version");
    let classes = info["Classes"]
        .as_array()
        .ok_or("Its moduleinfo.json lists no classes.")?;
    let mut plugins = Vec::new();
    for class in classes {
        if field(class, "Category") != PLUGIN_CATEGORY {
            continue;
        }
        let id = field(class, "CID").to_ascii_uppercase();
        if id.len() != 32 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(format!(
                "Its moduleinfo.json has a class id that isn't one ({id})."
            ));
        }
        let categories: Vec<String> = class["Sub Categories"]
            .as_array()
            .map(|list| {
                list.iter()
                    .filter_map(|c| c.as_str())
                    .flat_map(sub_categories)
                    .collect()
            })
            .unwrap_or_default();
        let vendor = Some(field(class, "Vendor"))
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| factory_vendor.clone());
        let version = Some(field(class, "Version"))
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| module_version.clone());
        plugins.push(PluginInfo {
            format: Format::Vst3,
            id,
            name: field(class, "Name"),
            vendor,
            version,
            kind: kind_of(&categories),
            categories,
            path: bundle.to_owned(),
        });
    }
    Ok(plugins)
}

/// The plugins a module's factory lists. The factory's newer interface
/// (IPluginFactory2) has each one's sub-categories, maker and version;
/// with only the first, the maker is the factory's.
///
/// # Safety
/// `factory` must be a working factory, from a module still loaded.
pub unsafe fn read_factory(factory: &ComPtr<IPluginFactory>, path: &Path) -> Vec<PluginInfo> {
    let mut factory_info: PFactoryInfo = unsafe { std::mem::zeroed() };
    let factory_vendor = if unsafe { factory.getFactoryInfo(&mut factory_info) } == kResultOk {
        text(&factory_info.vendor)
    } else {
        String::new()
    };
    let factory2 = factory.cast::<IPluginFactory2>();
    let mut plugins = Vec::new();
    for index in 0..unsafe { factory.countClasses() } {
        let mut info: PClassInfo2 = unsafe { std::mem::zeroed() };
        if let Some(factory2) = &factory2
            && unsafe { factory2.getClassInfo2(index, &mut info) } == kResultOk
        {
            if text(&info.category) != PLUGIN_CATEGORY {
                continue;
            }
            let categories = sub_categories(&text(&info.subCategories));
            let vendor = Some(text(&info.vendor))
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| factory_vendor.clone());
            plugins.push(PluginInfo {
                format: Format::Vst3,
                id: class_id(&info.cid),
                name: text(&info.name),
                vendor,
                version: text(&info.version),
                kind: kind_of(&categories),
                categories,
                path: path.to_owned(),
            });
            continue;
        }
        let mut info: PClassInfo = unsafe { std::mem::zeroed() };
        if unsafe { factory.getClassInfo(index, &mut info) } == kResultOk
            && text(&info.category) == PLUGIN_CATEGORY
        {
            plugins.push(PluginInfo {
                format: Format::Vst3,
                id: class_id(&info.cid),
                name: text(&info.name),
                vendor: factory_vendor.clone(),
                version: String::new(),
                kind: Kind::Effect,
                categories: Vec::new(),
                path: path.to_owned(),
            });
        }
    }
    plugins
}

type GetFactory = unsafe extern "system" fn() -> *mut IPluginFactory;
type Exit = unsafe extern "system" fn() -> bool;

/// A loaded module: its entry function has been called, and its exit
/// function is called as it's dropped, before it's unloaded.
pub struct Module {
    get_factory: GetFactory,
    exit: Option<Exit>,
    #[cfg(not(target_os = "macos"))]
    _library: libloading::Library,
    #[cfg(target_os = "macos")]
    _bundle: objc2_core_foundation::CFRetained<objc2_core_foundation::CFBundle>,
}

impl Module {
    /// Loads the module in a bundle (or a single-file module) and calls
    /// its entry function.
    ///
    /// # Safety
    /// This runs the plugin's own code, which can do anything.
    pub unsafe fn load(path: &Path) -> Result<Module, String> {
        unsafe { Self::load_here(path) }
    }

    #[cfg(not(target_os = "macos"))]
    unsafe fn load_here(path: &Path) -> Result<Module, String> {
        let binary = binary(path).ok_or("It has no binary for this system.")?;
        #[cfg(unix)]
        let library = {
            use libloading::os::unix::{Library, RTLD_LAZY, RTLD_LOCAL};
            unsafe { Library::open(Some(&binary), RTLD_LAZY | RTLD_LOCAL) }
                .map_err(|e| format!("It couldn't be loaded ({e})."))?
        };
        #[cfg(windows)]
        let library = unsafe { libloading::os::windows::Library::new(&binary) }
            .map_err(|e| format!("It couldn't be loaded ({e})."))?;

        let get_factory: GetFactory = *unsafe { library.get(b"GetPluginFactory\0") }
            .map_err(|_| "It has no GetPluginFactory function.".to_owned())?;

        #[cfg(unix)]
        let (library, exit) = {
            // ModuleEntry and ModuleExit are mandatory; ModuleEntry gets
            // the library's handle.
            let entry: unsafe extern "system" fn(*mut c_void) -> bool =
                *unsafe { library.get(b"ModuleEntry\0") }
                    .map_err(|_| "It has no ModuleEntry function.".to_owned())?;
            let exit: Exit = *unsafe { library.get(b"ModuleExit\0") }
                .map_err(|_| "It has no ModuleExit function.".to_owned())?;
            let handle = library.into_raw();
            let library = unsafe { libloading::os::unix::Library::from_raw(handle) };
            if !unsafe { entry(handle) } {
                return Err("Its ModuleEntry function failed.".into());
            }
            (library, Some(exit))
        };
        #[cfg(windows)]
        let exit = {
            // InitDll and ExitDll are optional.
            if let Ok(entry) =
                unsafe { library.get::<unsafe extern "system" fn() -> bool>(b"InitDll\0") }
                && !unsafe { entry() }
            {
                return Err("Its InitDll function failed.".into());
            }
            unsafe { library.get::<Exit>(b"ExitDll\0") }
                .ok()
                .map(|f| *f)
        };

        Ok(Module {
            get_factory,
            exit,
            _library: library.into(),
        })
    }

    #[cfg(target_os = "macos")]
    unsafe fn load_here(path: &Path) -> Result<Module, String> {
        use objc2_core_foundation::{CFBundle, CFRetained, CFString, CFURL};

        let url = CFURL::from_directory_path(path).ok_or("Its path isn't one macOS takes.")?;
        let bundle = CFBundle::new(None, Some(&url)).ok_or("It isn't a bundle macOS can open.")?;
        if !unsafe { bundle.load_executable() } {
            return Err("It couldn't be loaded (it may not be built for this Mac).".into());
        }
        let function =
            |name: &str| bundle.function_pointer_for_name(Some(&CFString::from_str(name)));
        // bundleEntry and bundleExit are mandatory; bundleEntry gets the
        // bundle.
        let entry = Some(function("bundleEntry"))
            .filter(|f| !f.is_null())
            .or_else(|| Some(function("BundleEntry")).filter(|f| !f.is_null()))
            .ok_or("It has no bundleEntry function.")?;
        let exit = Some(function("bundleExit"))
            .filter(|f| !f.is_null())
            .or_else(|| Some(function("BundleExit")).filter(|f| !f.is_null()))
            .ok_or("It has no bundleExit function.")?;
        let get_factory = Some(function("GetPluginFactory"))
            .filter(|f| !f.is_null())
            .ok_or("It has no GetPluginFactory function.")?;
        let (entry, exit, get_factory) = unsafe {
            (
                std::mem::transmute::<*mut c_void, unsafe extern "system" fn(*mut c_void) -> bool>(
                    entry,
                ),
                std::mem::transmute::<*mut c_void, Exit>(exit),
                std::mem::transmute::<*mut c_void, GetFactory>(get_factory),
            )
        };
        if !unsafe { entry(CFRetained::as_ptr(&bundle).as_ptr().cast()) } {
            return Err("Its bundleEntry function failed.".into());
        }
        Ok(Module {
            get_factory,
            exit: Some(exit),
            _bundle: bundle,
        })
    }

    /// The module's factory.
    pub fn factory(&self) -> Option<ComPtr<IPluginFactory>> {
        // GetPluginFactory hands over a reference, which the ComPtr owns.
        unsafe { ComPtr::from_raw((self.get_factory)()) }
    }
}

impl Drop for Module {
    fn drop(&mut self) {
        if let Some(exit) = self.exit {
            unsafe { exit() };
        }
    }
}

/// Loads the module and reads its factory, in this process. The scanner
/// does that in a process of its own (`scan::child_main`), in case the
/// plugin crashes.
///
/// # Safety
/// This runs the plugin's own code, which can do anything.
pub unsafe fn load(path: &Path) -> Result<Vec<PluginInfo>, String> {
    let module = unsafe { Module::load(path) }?;
    let factory = module
        .factory()
        .ok_or("Its GetPluginFactory gave nothing.")?;
    let plugins = unsafe { read_factory(&factory, path) };
    drop(factory);
    drop(module);
    Ok(plugins)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_module_info_with_comments_and_trailing_commas() {
        let text = r#"{
            // As the SDK's moduleinfotool writes them.
            "Name": "Echoes",
            "Version": "2.1.0",
            "Factory Info": { "Vendor": "Acme Audio", "URL": "https://acme.example/a,b", },
            "Classes": [
                {
                    "CID": "84e8de5f92554f5396fae4133c935a18",
                    "Category": "Audio Module Class",
                    "Name": "Echoes \"Tape\"",
                    "Sub Categories": [ "Fx|Delay", ],
                    "Class Flags": 1,
                },
                /* its controller */
                { "CID": "D39D5B65D7AF42FA843F4AC841EB04F0", "Category": "Component Controller Class", "Name": "Echoes" },
                {
                    "CID": "6EE65CD1B83A4AF480AA7929AEA6B8A0",
                    "Category": "Audio Module Class",
                    "Name": "Echoes Synth",
                    "Vendor": "Acme",
                    "Version": "2.2.0",
                    "Sub Categories": [ "Instrument", "Synth" ],
                },
            ],
        }"#;
        let plugins = parse_module_info(text, Path::new("/p/Echoes.vst3")).unwrap();
        assert_eq!(plugins.len(), 2);
        assert_eq!(
            plugins[0],
            PluginInfo {
                format: Format::Vst3,
                id: "84E8DE5F92554F5396FAE4133C935A18".into(),
                name: "Echoes \"Tape\"".into(),
                vendor: "Acme Audio".into(),
                version: "2.1.0".into(),
                kind: Kind::Effect,
                categories: vec!["Fx".into(), "Delay".into()],
                path: PathBuf::from("/p/Echoes.vst3"),
            }
        );
        assert_eq!(plugins[1].kind, Kind::Instrument);
        assert_eq!(plugins[1].vendor, "Acme");
        assert_eq!(plugins[1].version, "2.2.0");
        assert_eq!(plugins[1].categories, ["Instrument", "Synth"]);
    }

    #[test]
    fn a_module_info_that_isnt_one_says_so() {
        let error = parse_module_info(
            "{ \"Classes\": [ { \"CID\": \"12\", \"Category\": \"Audio Module Class\" } ] }",
            Path::new("x"),
        )
        .unwrap_err();
        assert!(error.contains("class id"), "{error}");
        assert!(parse_module_info("not json", Path::new("x")).is_err());
    }

    #[test]
    fn finds_the_binary_for_this_system_in_a_bundle() {
        let root = std::env::temp_dir().join(format!("dawn-binary-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let bundle = root.join("Pro-Q 3.1.vst3");
        let (arch, file) = match std::env::consts::OS {
            "windows" => ("x86_64-win".to_owned(), "Pro-Q 3.1.vst3".to_owned()),
            "macos" => ("MacOS".to_owned(), "Pro-Q 3.1".to_owned()),
            _ => (
                format!("{}-linux", std::env::consts::ARCH),
                "Pro-Q 3.1.so".to_owned(),
            ),
        };
        let folder = bundle.join("Contents").join(arch);
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join(&file), b"").unwrap();
        std::fs::write(folder.join("notes.txt"), b"").unwrap();
        assert_eq!(binary(&bundle), Some(folder.join(&file)));
        // Renamed bundle: the one binary there.
        let renamed = root.join("Renamed.vst3");
        std::fs::rename(&bundle, &renamed).unwrap();
        let folder = renamed.join(folder.strip_prefix(&bundle).unwrap());
        if cfg!(target_os = "macos") {
            // Any file in Contents/MacOS is taken there.
            assert!(binary(&renamed).is_some());
        } else {
            assert_eq!(binary(&renamed), Some(folder.join(&file)));
        }
        // A single-file module is its own binary; a bundle with none has none.
        std::fs::write(root.join("Old.vst3"), b"").unwrap();
        assert_eq!(binary(&root.join("Old.vst3")), Some(root.join("Old.vst3")));
        std::fs::create_dir_all(root.join("Empty.vst3/Contents/Resources")).unwrap();
        assert_eq!(binary(&root.join("Empty.vst3")), None);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn class_ids_read_the_same_on_every_system() {
        // As the SDK's INLINE_UID and the vst3 crate's uid() lay it out on
        // this system.
        let cid = vst3::uid(0x84E8DE5F, 0x92554F53, 0x96FAE413, 0x3C935A18);
        assert_eq!(class_id(&cid), "84E8DE5F92554F5396FAE4133C935A18");
    }
}
