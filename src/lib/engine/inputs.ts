// The audio inputs: the audio interface (one shared stream, opened when
// first needed) and other tracks ("Audio From"), and each audio track's
// monitor - its input heard live through its effects.

import * as Tone from "tone";
import type { SidechainTap } from "../../effects/sidechain/sidechainModel";
import type { TrackInput } from "../types";
import { noteIssue } from "../issues";

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

export class InputManager {
  constructor(private readonly host: InputHost) {}

  /** Which input device recordings should capture from - null means the
   * browser's default. Set via `setMicDevice`, e.g. after plugging in an
   * audio interface and picking it from a track's own Input select. */
  private micDeviceId: string | null = null;

  /** Per-channel live input-monitor taps - open only while that channel is
   * both armed and monitoring is enabled (see `setInputMonitoring`). Each
   * is fed by the shared mic source, so what you hear is the same clean
   * capture (no echo cancellation, noise suppression or auto gain) that
   * gets recorded. */
  private monitorNodes = new Map<string, Tone.Gain>();
  /** What each monitor is plugged into: the interface input, or another
   * track's tap (its "Audio From"). */
  private monitorFeeds = new Map<string, Tone.OutputNode>();
  /** Audio tracks taking another track's audio as their input. */
  private trackInputs = new Map<string, TrackInput>();
  /** The open interface input, if any. */
  private micStream: MediaStream | null = null;

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
      if (node !== undefined) this.plugMonitor(id, node);
      else if (this.micSource) this.plugMonitor(id, this.micSource);
      else {
        // Back on the interface input, which isn't open yet.
        this.plugMonitor(id, null);
        void this.ensureMicSource()
          .then((mic) => {
            if (this.monitorNodes.has(id) && !this.trackInputs.has(id)) this.plugMonitor(id, mic);
          })
          // No input (refused, unplugged): the track stays unmonitored.
          .catch((error) => noteIssue("input.monitor", error, { report: false }));
      }
    });
  }

  /** One long-lived graph input for the mic stream, shared by every
   * capture (see InputRecorder.start). */
  private micSource: MediaStreamAudioSourceNode | null = null;

  async ensureMicSource(): Promise<MediaStreamAudioSourceNode> {
    const stream = await this.ensureMicStream();
    if (!this.micSource || this.micSource.mediaStream !== stream) {
      this.micSource?.disconnect();
      this.micSource = Tone.getContext().createMediaStreamSource(stream) as unknown as MediaStreamAudioSourceNode;
      // The input meter listens to the raw input, before any effect.
      this.inputAnalyser ??= Tone.getContext().createAnalyser() as unknown as AnalyserNode;
      this.inputAnalyser.fftSize = 2048;
      this.micSource.connect(this.inputAnalyser);
    }
    return this.micSource;
  }

  private inputAnalyser: AnalyserNode | null = null;
  private inputSamples: Float32Array<ArrayBuffer> | null = null;

  /** The input's peak level (0..1, 1 = full scale) over the last ~40 ms,
   * or null while no input is open. For the armed track's input meter. */
  getInputPeak(): number | null {
    const analyser = this.inputAnalyser;
    if (!analyser || !this.micSource) return null;
    if (this.inputSamples?.length !== analyser.fftSize) this.inputSamples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(this.inputSamples);
    let peak = 0;
    for (const v of this.inputSamples) peak = Math.max(peak, Math.abs(v));
    return peak;
  }

  /** Opens the input (asking for permission the first time) so the armed
   * track's meter shows the level before recording. */
  async openInput(): Promise<void> {
    await this.host.ensureStarted();
    await this.ensureMicSource();
  }

  private async ensureMicStream(): Promise<MediaStream> {
    if (this.micStream) return this.micStream;
    // `channelCount: { ideal: 1 }` asks for a single (mono) capture rather
    // than whatever multi-channel width the selected device natively
    // exposes - without it, some audio interfaces hand back every input
    // channel summed together regardless of which single `deviceId` was
    // requested. Echo cancellation, noise suppression and auto gain are
    // made for calls: they pump, gate and dull an instrument, so they're
    // off. Recording and monitoring both use this one stream.
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(this.micDeviceId ? { deviceId: { exact: this.micDeviceId } } : {}),
        channelCount: { ideal: 1 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    return this.micStream;
  }

  /** Requests mic permission (prompting the user the first time) without
   * starting a recording - lets a caller (e.g. a track's Input select,
   * on focus) unlock the browser's full, labeled device list ahead of
   * time, since `enumerateDevices` only returns generic/blank entries
   * until permission has been granted at least once. */
  async requestMicAccess(): Promise<void> {
    await this.ensureMicStream();
  }

  /** Switches which input device future recordings and monitoring capture
   * from. Drops any already-open mic stream so `ensureMicStream`
   * re-requests `getUserMedia` against the new device instead of reusing
   * the old one, and reopens any active monitor taps on the new device -
   * a no-op while nothing's open yet. */
  setMicDevice(deviceId: string | null): void {
    if (this.micDeviceId === deviceId) return;
    this.micDeviceId = deviceId;
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }
    this.micSource?.disconnect();
    this.micSource = null;
    // Monitors on the interface input reopen on the new device.
    [...this.monitorNodes.keys()].forEach((channelId) => this.monitorFeeds.delete(channelId));
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
    if (this.trackInputNode(channelId) === undefined) {
      try {
        await this.ensureMicSource();
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
    this.plugMonitor(channelId, node !== undefined ? node : this.micSource);
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

  /** The open interface stream's settings (latency, sample rate), if open. */
  get inputSettings(): (MediaTrackSettings & { latency?: number }) | null {
    return (this.micStream?.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number }) ?? null;
  }
}
