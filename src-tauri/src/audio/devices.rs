//! The audio devices the studio can play through: each driver type on this
//! system (Core Audio; WASAPI and, when built with it, ASIO; ALSA...) and
//! its output devices, with the sample rates and buffer sizes they take.

use cpal::traits::{DeviceTrait, HostTrait};
use cpal::{SupportedBufferSize, SupportedStreamConfigRange};
use serde::Serialize;

/// Sample rates offered when a device takes a range.
const COMMON_RATES: [u32; 6] = [44_100, 48_000, 88_200, 96_000, 176_400, 192_000];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    /// What `audio_open` takes ("wasapi:…", "asio:…").
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub sample_rates: Vec<u32>,
    /// The buffer sizes (frames) it allows, when it says.
    pub min_buffer: Option<u32>,
    pub max_buffer: Option<u32>,
    pub default_sample_rate: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverInfo {
    /// cpal's name for it ("ASIO", "WASAPI", "CoreAudio", "ALSA").
    pub id: String,
    pub name: String,
    pub devices: Vec<DeviceInfo>,
}

fn rates(configs: &[SupportedStreamConfigRange]) -> Vec<u32> {
    let mut out: Vec<u32> = COMMON_RATES
        .into_iter()
        .filter(|r| {
            configs
                .iter()
                .any(|c| c.min_sample_rate() <= *r && *r <= c.max_sample_rate())
        })
        .collect();
    // A device with only odd rates still offers them.
    if out.is_empty() {
        out = configs.iter().map(|c| c.max_sample_rate()).collect();
    }
    out.sort_unstable();
    out.dedup();
    out
}

fn buffers(configs: &[SupportedStreamConfigRange]) -> (Option<u32>, Option<u32>) {
    let ranges: Vec<(u32, u32)> = configs
        .iter()
        .filter_map(|c| match c.buffer_size() {
            SupportedBufferSize::Range { min, max } => Some((*min, *max)),
            SupportedBufferSize::Unknown => None,
        })
        .collect();
    if ranges.is_empty() {
        return (None, None);
    }
    (
        ranges.iter().map(|r| r.0).min(),
        ranges.iter().map(|r| r.1).max(),
    )
}

/// Every driver type and its output devices. A device that can't be asked
/// (unplugged as it's listed, busy) is left out.
pub fn list() -> Vec<DriverInfo> {
    cpal::available_hosts()
        .into_iter()
        .filter_map(|host_id| {
            let host = cpal::host_from_id(host_id).ok()?;
            let default_id = host.default_output_device().and_then(|d| d.id().ok());
            let devices = host
                .output_devices()
                .ok()?
                .filter_map(|device| {
                    let id = device.id().ok()?;
                    let name = device
                        .description()
                        .ok()
                        .map_or_else(|| device.to_string(), |d| d.name().to_owned());
                    let configs: Vec<_> = device.supported_output_configs().ok()?.collect();
                    if configs.is_empty() {
                        return None;
                    }
                    let (min_buffer, max_buffer) = buffers(&configs);
                    Some(DeviceInfo {
                        is_default: default_id.as_ref() == Some(&id),
                        id: id.to_string(),
                        name,
                        sample_rates: rates(&configs),
                        min_buffer,
                        max_buffer,
                        default_sample_rate: device
                            .default_output_config()
                            .ok()
                            .map(|c| c.sample_rate()),
                    })
                })
                .collect();
            Some(DriverInfo {
                id: format!("{host_id:?}"),
                name: host_id.name().to_owned(),
                devices,
            })
        })
        .collect()
}
