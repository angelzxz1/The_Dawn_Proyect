// WAV encoding for exports (16-bit), recordings (24-bit), and takes from
// other tracks (32-bit float, which keeps peaks above full scale).

/** Encodes one Float32Array per channel (all the same length) as a WAV
 * file: integer PCM at 16 or 24 bits, or 32-bit float. */
export function encodeWav(channels: Float32Array[], sampleRate: number, bits: 16 | 24 | 32 = 16): Blob {
  const numChannels = channels.length;
  const numFrames = channels[0]?.length ?? 0;
  const bytesPerSample = bits / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const view = new DataView(new ArrayBuffer(44 + dataSize));
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, bits === 32 ? 3 : 1, true); // IEEE float or PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bits, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let frame = 0; frame < numFrames; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      if (bits === 32) {
        view.setFloat32(offset, channels[ch][frame], true);
        offset += bytesPerSample;
        continue;
      }
      const sample = Math.max(-1, Math.min(1, channels[ch][frame]));
      if (bits === 16) {
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      } else {
        const v = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7fffff);
        view.setUint8(offset, v & 0xff);
        view.setUint8(offset + 1, (v >> 8) & 0xff);
        view.setUint8(offset + 2, (v >> 16) & 0xff);
      }
      offset += bytesPerSample;
    }
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}
