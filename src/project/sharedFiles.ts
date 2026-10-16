// Clips often play the same file - the parts of a split clip, the takes of
// one recording and the comp made from them - each clip id holding the
// same Blob. Saved, each file is written once: the first id that has it
// keeps it, and the others say whose it is.

/** Each file once (under the first id that has it), and for every other
 * id, the id whose file it plays. */
export function shareFiles(blobs: ReadonlyMap<string, Blob>): { files: Map<string, Blob>; aliases: Record<string, string> } {
  const owners = new Map<Blob, string>();
  const files = new Map<string, Blob>();
  const aliases: Record<string, string> = {};
  blobs.forEach((blob, id) => {
    const owner = owners.get(blob);
    if (owner !== undefined) {
      aliases[id] = owner;
      return;
    }
    owners.set(blob, id);
    files.set(id, blob);
  });
  return { files, aliases };
}

/** The files by every id again (see shareFiles), the same Blob for the ids
 * that share one. An alias to a file that isn't there is left out. */
export function unshareFiles(files: ReadonlyMap<string, Blob>, aliases: unknown): Map<string, Blob> {
  const out = new Map(files);
  if (!aliases || typeof aliases !== "object" || Array.isArray(aliases)) return out;
  Object.entries(aliases as Record<string, unknown>).forEach(([id, owner]) => {
    const blob = typeof owner === "string" ? files.get(owner) : undefined;
    if (blob && !out.has(id)) out.set(id, blob);
  });
  return out;
}
