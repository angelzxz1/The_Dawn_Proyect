# Adding amp captures and cabinet IRs

There are two places tones can live, depending on who gets them.

## 1. Built-in tones (everyone, free)

These ship with the site and appear in the NAM Amp's **Browse amp tones**
and the IR Loader's **Browse cabinets**, downloaded only when someone picks
them.

- **Files:** put them in `public/tones/`: amp captures as `.nam`, cabinet
  IRs as `.wav` (mono or stereo, 44.1 or 48 kHz). Typical sizes are 0.3–2 MB
  for a capture and well under 1 MB for an IR; Cloudflare Pages takes up to
  25 MiB per file.
- **List them** in `public/tones/manifest.json`, one entry each:

  ```json
  {
    "id": "plexi-crunch",
    "kind": "amp",
    "name": "Plexi Crunch",
    "description": "A cranked vintage British head: classic rock rhythm.",
    "creator": "Jane Doe",
    "creatorUrl": "https://www.tone3000.com/…",
    "license": "Used with permission",
    "file": "tones/plexi-crunch.nam",
    "use": "guitar",
    "light": false
  }
  ```

  `kind` is `amp` or `ir`; `use` is `guitar` or `bass`; set `light: true`
  for "feather"/"nano" captures that cost less CPU.
- **Credit them** in `src/content/licenses.json` with the same id prefixed
  `tone:` (for the example, `tone:plexi-crunch`), kind `sound`, the
  creator, the license, where it came from and the date permission was
  given (`added`), plus `permission` (how: an email, a message). A test fails
  if a tone in the manifest has no credit, so nothing ships uncredited.

**Only ship files you made, or that you have written permission or an
open license for.** The repository is public, so anything in
`public/tones/` can be downloaded by anyone. Many free capture packs allow
use but not redistribution.

### Getting the files to Claude

Either upload them in the conversation (as you did with the plan PDF), or
add them on GitHub (the repository → `public/tones` → **Add file → Upload
files**, on the working branch). Along with the files, give for each one:
the display name, a one-line description, the creator's name and link,
the license or how permission was given (and when), and whether it's for
guitar or bass and is a light capture. Claude adds the manifest and credit
entries, checks every file loads in the NAM Amp or IR Loader, and commits.

## 2. Supporter packs (Patreon)

Monthly packs shouldn't go in the public repository. They're `.dawnpack`
files (see `src/project/dawnPack.ts` for the format) that supporters download
from Patreon and install with **File → Sound Packs**: captures go in
`nam/`, IRs in `irs/`, plus any presets, kits and grooves. Ask Claude to
build one from a folder of files.

## Lots of large files later

If the tone library grows past what's comfortable in the repository, the
files can move to Cloudflare R2 (object storage with no download fees)
behind a public bucket URL; the manifest would then point at that address.
