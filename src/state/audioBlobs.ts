// The audio behind each audio clip (a recording or an imported file), by
// clip id: what Save writes out, and what an object URL plays from.

const blobs = new Map<string, Blob>();

export const audioBlobs = {
  get: (clipId: string) => blobs.get(clipId),
  set: (clipId: string, blob: Blob) => void blobs.set(clipId, blob),
  delete: (clipId: string) => void blobs.delete(clipId),
  clear: () => blobs.clear(),
  forEach: (fn: (blob: Blob, clipId: string) => void) => blobs.forEach(fn),
  /** A copy, for saving in the background while editing goes on. */
  snapshot: () => new Map(blobs),
};
