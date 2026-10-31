// The audio inputs: the audio interface's (each track picks its own device;
// a stream per device in use, opened when first needed) and other tracks
// ("Audio From"), and each audio track's monitor - its input heard live
// through its effects.

import * as Tone from "tone";
import type { SidechainTap } from "../effects/sidechain/sidechainModel";
import type { TrackInput } from "../project/types";
import { noteIssue } from "../services/issues";

/** What the input manager needs from the engine. */
export interface InputHost {
  hasTrack(id: string): boolean;
  /** A track's tap point, or null if the track isn't there. */
  tap(trackId: string, tap: SidechainTap): Tone.ToneAudioNode | null;
  ensureStarted(): Promise<void>;
  /** A track's sources changed (its monitor opened or closed). */
  rewireTrack(id: string): void;
}

/** Whether the browser already lets the page use the microphone (so
 * opening it won't ask). False when it would ask, or can't tell. */
export async function microphoneAllowed(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state === "granted";
  } catch {
    // No Permissions API (or no "microphone" in it): don't assume.
    return false;
  }
}

/** An open input device: its stream, its graph input, and the analyser
 * its meter reads. */
interface OpenDevice {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
}

/** The browser's default input, as a device key. */
const DEFAULT_DEVICE = "";

export class InputManager {
  constructor(private readonly host: InputHost) {}

  /** Each audio track's input device (setTrackDevices); a track not in it
   * takes the browser's default. */
  private trackDevices = new Map<string, string>();
  /** The open devices, by id (DEFAULT_DEVICE for the default), and those
   * opening. */
  private devices = new Map<string, OpenDevice>();
  private opening = new Map<string, Promise<OpenDevice>>();

  /** Per-channel live input-monitor taps - open only while that channel is
   * both armed and monitoring is enabled (see `setInputMonitoring`). Each
   * is fed by its track's device, so what you hear is the same clean
   * capture (no echo cancellation, noise suppression or auto gain) that
   * gets recorded. */
  private monitorNodes = new Map<string, Tone.Gain>();
  /** What each monitor is plugged into: the interface input, or another
   * track's tap (its "Audio From"). */
  private monitorFeeds = new Map<string, Tone.OutputNode>();
  /** Audio tracks taking another track's audio as their input. */
  private trackInputs = new Map<string, TrackInput>();

  private deviceOf(channelId: string): string {
    return this.trackDevices.get(channelId) ?? DEFAULT_DEVICE;
  }

  /** A track's input when it comes from another track: that track's tap,
   * or null while it's missing. Undefined: the audio interface. */
  trackInputNode(channelId: string): Tone.ToneAudioNode | null | undefined {
    const input = this.trackInputs.get(channelId);
    if (!input) return undefined;
    return this.host.tap(input.track, input.tap);
  }

  /** Plugs a track's monitor into `feed` (unplugging what it had). */
  private plugMonitor(channelId: string, feed: Tone.OutputNode | null): void {
    const gain = this.monitorNodes.get(channelId);
    const old = this.monitorFeeds.get(channelId);
    if (!gain || old === feed) return;
    if (old) {
      try {
        Tone.disconnect(old, gain);
      } catch {
        // Already gone (a removed track's tap, a closed input device).
      }
    }
    this.monitorFeeds.delete(channelId);
    if (feed) {
      Tone.connect(feed, gain);
      this.monitorFeeds.set(channelId, feed);
    }
  }

  /** Points every monitor at its track's current input - after the routing
   * changed, or a source track was rebuilt. */
  replug(): void {
    this.monitorNodes.forEach((_, id) => {
      const node = this.trackInputNode(id);
      const device = this.deviceOf(id);
      const open = this.devices.get(device);
      if (node !== undefined) this.plugMonitor(id, node);
      else if (open) this.plugMonitor(id, open.source);
      else {
        // On an interface input that isn't open yet.
        this.plugMonitor(id, null);
        void this.ensureDevice(device)
          .then((opened) => {
            if (this.monitorNodes.has(id) && !this.trackInputs.has(id) && this.deviceOf(id) === device) this.plugMonitor(id, opened.source);
          })
          // No input (refused, unplugged): the track stays unmonitored.
          .catch((error) => noteIssue("input.monitor", error, { report: false }));
      }
    });
  }

  /** An input device, open: one stream and graph input per device, shared
   * by every track on it, every capture (see InputRecorder.start) and its
   * meter. */
  private ensureDevice(device: string): Promise<OpenDevice> {
    const open = this.devices.get(device);
    if (open) return Promise.resolve(open);
    const pending = this.opening.get(device);
    if (pending) return pending;
    const opening = (async () => {
      // `channelCount: { ideal: 1 }` asks for a single (mono) capture
      // rather than whatever multi-channel width the device natively
      // exposes - without it, some audio interfaces hand back every input
      // channel summed together regardless of which single `deviceId` was
      // requested. Echo cancellation, noise suppression and auto gain are
      // made for calls: they pump, gate and dull an instrument, so they're
      // off. Recording and monitoring both use this one stream.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(device ? { deviceId: { exact: device } } : {}),
          channelCount: { ideal: 1 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const context = Tone.getContext();
      const source = context.createMediaStreamSource(stream);
      // The input meter listens to the raw input, before any effect.
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const opened = { stream, source, analyser };
      this.devices.set(device, opened);
      return opened;
    })();
    this.opening.set(device, opening);
    opening.then(
      () => this.opening.delete(device),
      () => this.opening.delete(device)
    );
    return opening;
  }

  /** A track's interface input (its device's), opened if it isn't. */
  async inputSource(channelId: string): Promise<MediaStreamAudioSourceNode> {
    return (await this.ensureDevice(this.deviceOf(channelId))).source;
  }

  private inputSamples: Float32Array<ArrayBuffer> | null = null;

  /** A track's input peak level (0..1, 1 = full scale) over the last ~40
   * ms, or null while its device isn't open. For its input meter. */
  getInputPeak(channelId: string): number | null {
    const analyser = this.devices.get(this.deviceOf(channelId))?.analyser;
    if (!analyser) return null;
    if (this.inputSamples?.length !== analyser.fftSize) this.inputSamples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(this.inputSamples);
    let peak = 0;
    for (const v of this.inputSamples) peak = Math.max(peak, Math.abs(v));
    return peak;
  }

  /** Opens a track's input (asking for permission the first time) so its
   * meter shows the level before recording. */
  async openInput(channelId: string): Promise<void> {
    await this.host.ensureStarted();
    await this.inputSource(channelId);
  }

  /** Requests mic permission (prompting the user the first time) without
   * starting a recording - lets a caller (e.g. a track's Input select,
   * on focus) unlock the browser's full, labeled device list ahead of
   * time, since `enumerateDevices` only returns generic/blank entries
   * until permission has been granted at least once. */
  async requestMicAccess(): Promise<void> {
    await this.ensureDevice(DEFAULT_DEVICE);
  }

  /** Each audio track's input device (null: the browser's default). A
   * track whose device changed reopens its monitor on the new one; a
   * device no track uses any more is closed (the default stays open once
   * it is). */
  setTrackDevices(devices: Map<string, string | null>): void {
    const next = new Map<string, string>();
    devices.forEach((device, id) => {
      if (device) next.set(id, device);
    });
    const ids = new Set([...this.trackDevices.keys(), ...next.keys()]);
    const changed = [...ids].filter((id) => this.trackDevices.get(id) !== next.get(id));
    this.trackDevices = next;
    if (changed.length === 0) return;
    const used = new Set([DEFAULT_DEVICE, ...next.values()]);
    this.devices.forEach((open, device) => {
      if (used.has(device)) return;
      open.source.disconnect();
      open.stream.getTracks().forEach((track) => track.stop());
      this.devices.delete(device);
    });
    // Monitors on the interface input move to their track's device.
    changed.forEach((id) => {
      if (this.monitorNodes.has(id) && !this.trackInputs.has(id)) this.plugMonitor(id, null);
    });
    this.replug();
  }

  /** Lists the browser's available audio input devices (an interface's
   * separate inputs included, once the OS exposes them). Device labels -
   * and, on some browsers, entries for anything past the first device -
   * come back blank/missing until mic permission has been granted at
   * least once; call `requestMicAccess` first (or just try recording) to
   * unlock the real list, then call this again. */
  async listInputDevices(): Promise<{ deviceId: string; label: string }[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "audioinput")
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  }

  /** Starts or stops hearing the audio input live through an audio
   * channel - through its effects, like a clip. Resolves false if the input
   * couldn't be opened (no permission, no device). */
  async setInputMonitoring(channelId: string, enabled: boolean): Promise<boolean> {
    if (!enabled) {
      const gain = this.monitorNodes.get(channelId);
      if (gain) {
        this.plugMonitor(channelId, null);
        gain.dispose();
        this.monitorNodes.delete(channelId);
        this.host.rewireTrack(channelId);
      }
      return true;
    }
    if (!this.host.hasTrack(channelId)) return false;
    if (this.monitorNodes.has(channelId)) return true;
    await this.host.ensureStarted();
    // Another track's audio needs no permission; the interface does.
    let device: OpenDevice | undefined;
    if (this.trackInputNode(channelId) === undefined) {
      try {
        device = await this.ensureDevice(this.deviceOf(channelId));
      } catch (error) {
        noteIssue("input.open", error, { report: false });
        return false;
      }
    }
    // The channel (or the whole engine) may have gone away while the
    // permission prompt/device open was in flight.
    if (!this.host.hasTrack(channelId) || this.monitorNodes.has(channelId)) {
      return this.monitorNodes.has(channelId);
    }
    this.monitorNodes.set(channelId, new Tone.Gain(1));
    const node = this.trackInputNode(channelId);
    this.plugMonitor(channelId, node !== undefined ? node : (device?.source ?? null));
    this.host.rewireTrack(channelId);
    return true;
  }

  isMonitoring(channelId: string): boolean {
    return this.monitorNodes.has(channelId);
  }

  /** Which audio tracks take another track's audio (routing.ts), as the
   * mix plan accepted them. Monitors follow. */
  setTrackInputs(inputs: Map<string, TrackInput>): void {
    this.trackInputs = inputs;
    this.replug();
  }

  /** A track's input, when it's another track. */
  trackInput(channelId: string): TrackInput | undefined {
    return this.trackInputs.get(channelId);
  }

  /** The gain a monitored track's input arrives through (a source of the
   * track, like a clip), if it's monitoring. */
  monitor(channelId: string): Tone.Gain | undefined {
    return this.monitorNodes.get(channelId);
  }

  /** An open interface stream's settings (latency, sample rate): a
   * track's device's when it's given and open, else the default's, else
   * any open one's. */
  inputSettings(channelId?: string): (MediaTrackSettings & { latency?: number }) | null {
    const open =
      (channelId !== undefined ? this.devices.get(this.deviceOf(channelId)) : undefined) ??
      this.devices.get(DEFAULT_DEVICE) ??
      this.devices.values().next().value;
    return (open?.stream.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number }) ?? null;
  }
}
