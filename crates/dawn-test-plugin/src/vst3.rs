//! The VST3 side: a factory (IPluginFactory2) with the gain's processor
//! and controller and the tone's processor, and the module's entry and
//! exit functions for each system. The factory is only handed out once the
//! module's entry function has been called, as the SDK's hosting rules say
//! it must be (on Windows that function is optional).

#![allow(non_snake_case)]

use std::ffi::{c_char, c_void};
use std::sync::atomic::{AtomicBool, Ordering};

use vst3::Steinberg::*;
use vst3::{Class, ComWrapper, uid};

use crate::{GAIN_NAME, TONE_NAME, VENDOR, VERSION};

static ENTERED: AtomicBool = AtomicBool::new(cfg!(target_os = "windows"));

const GAIN_CID: TUID = uid(0x44415744, 0x4E544553, 0x54474149, 0x4E000001);
const GAIN_CONTROLLER_CID: TUID = uid(0x44415744, 0x4E544553, 0x54474149, 0x4E000002);
const TONE_CID: TUID = uid(0x44415744, 0x4E544553, 0x54544F4E, 0x45000001);

fn copy(text: &str, to: &mut [c_char]) {
    let n = text.len().min(to.len() - 1);
    for (dst, src) in to.iter_mut().zip(&text.as_bytes()[..n]) {
        *dst = *src as c_char;
    }
    to[n] = 0;
}

struct Factory;

impl Class for Factory {
    type Interfaces = (IPluginFactory2,);
}

/// The factory's classes: (id, category, name, sub-categories).
const CLASSES: [(TUID, &str, &str, &str); 3] = [
    (GAIN_CID, "Audio Module Class", GAIN_NAME, "Fx"),
    (
        GAIN_CONTROLLER_CID,
        "Component Controller Class",
        GAIN_NAME,
        "",
    ),
    (
        TONE_CID,
        "Audio Module Class",
        TONE_NAME,
        "Instrument|Synth",
    ),
];

impl IPluginFactoryTrait for Factory {
    unsafe fn getFactoryInfo(&self, info: *mut PFactoryInfo) -> tresult {
        let info = unsafe { &mut *info };
        copy(VENDOR, &mut info.vendor);
        copy("", &mut info.url);
        copy("", &mut info.email);
        info.flags = PFactoryInfo_::FactoryFlags_::kUnicode as int32;
        kResultOk
    }

    unsafe fn countClasses(&self) -> int32 {
        CLASSES.len() as int32
    }

    unsafe fn getClassInfo(&self, index: int32, info: *mut PClassInfo) -> tresult {
        let Some((cid, category, name, _)) = CLASSES.get(index as usize) else {
            return kInvalidArgument;
        };
        let info = unsafe { &mut *info };
        info.cid = *cid;
        info.cardinality = PClassInfo_::ClassCardinality_::kManyInstances as int32;
        copy(category, &mut info.category);
        copy(name, &mut info.name);
        kResultOk
    }

    unsafe fn createInstance(
        &self,
        _cid: FIDString,
        _iid: FIDString,
        _obj: *mut *mut c_void,
    ) -> tresult {
        // Nothing to run yet: the tests only find these.
        kNotImplemented
    }
}

impl IPluginFactory2Trait for Factory {
    unsafe fn getClassInfo2(&self, index: int32, info: *mut PClassInfo2) -> tresult {
        let Some((cid, category, name, sub_categories)) = CLASSES.get(index as usize) else {
            return kInvalidArgument;
        };
        let info = unsafe { &mut *info };
        info.cid = *cid;
        info.cardinality = PClassInfo_::ClassCardinality_::kManyInstances as int32;
        copy(category, &mut info.category);
        copy(name, &mut info.name);
        info.classFlags = 0;
        copy(sub_categories, &mut info.subCategories);
        copy(VENDOR, &mut info.vendor);
        copy(VERSION, &mut info.version);
        copy("VST 3.8.0", &mut info.sdkVersion);
        kResultOk
    }
}

#[unsafe(no_mangle)]
extern "system" fn GetPluginFactory() -> *mut IPluginFactory {
    if !ENTERED.load(Ordering::SeqCst) {
        return std::ptr::null_mut();
    }
    ComWrapper::new(Factory)
        .to_com_ptr::<IPluginFactory>()
        .map_or(std::ptr::null_mut(), |f| f.into_raw())
}

fn enter() -> bool {
    ENTERED.store(true, Ordering::SeqCst);
    true
}

fn exit() -> bool {
    ENTERED.store(cfg!(target_os = "windows"), Ordering::SeqCst);
    true
}

#[cfg(target_os = "windows")]
#[unsafe(no_mangle)]
extern "system" fn InitDll() -> bool {
    enter()
}

#[cfg(target_os = "windows")]
#[unsafe(no_mangle)]
extern "system" fn ExitDll() -> bool {
    exit()
}

#[cfg(target_os = "macos")]
#[unsafe(no_mangle)]
extern "system" fn bundleEntry(bundle: *mut c_void) -> bool {
    !bundle.is_null() && enter()
}

#[cfg(target_os = "macos")]
#[unsafe(no_mangle)]
extern "system" fn bundleExit() -> bool {
    exit()
}

#[cfg(target_os = "linux")]
#[unsafe(no_mangle)]
extern "system" fn ModuleEntry(library: *mut c_void) -> bool {
    !library.is_null() && enter()
}

#[cfg(target_os = "linux")]
#[unsafe(no_mangle)]
extern "system" fn ModuleExit() -> bool {
    exit()
}
