# Deploying Dawn

Dawn is one client-side page, so `npm run build` produces a plain static site
in `out/` (Next's `output: "export"`). Any static host can serve it; the steps
below are for Cloudflare Pages, which the launch plan recommends (free,
unlimited bandwidth for static files, 25 MiB per file).

## Cloudflare Pages

1. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**,
   and pick this repository.
2. Build settings:
   - Framework preset: **None**
   - Build command: `npm run build`
   - Build output directory: `out`
   - Environment variable `NODE_VERSION` = `22`
   - Environment variable `NEXT_PUBLIC_SITE_URL` = your address, for example
     `https://dawnproject.app` (used for social-card images)
3. Deploy. Every branch also gets its own preview URL; keep a `beta` branch
   deployed for early access.
4. **Custom domains → Set up a domain** to connect your own domain. HTTPS is
   automatic, and Dawn needs it: AudioWorklets, the microphone and saving
   project folders only work on HTTPS (or `localhost`).

`public/_headers` is copied into `out/` and sets the caching rules (a year
for hashed build files, a day for the amp engine), the `.wasm` content type,
and permission for the microphone and MIDI.

Dawn doesn't use `SharedArrayBuffer`, so it doesn't need cross-origin
isolation headers (COOP/COEP). Don't add them: they would block the piano
samples, which load from another site.

## Large files

Cloudflare Pages refuses files over 25 MiB. Put anything bigger (long
sample libraries, for example) on Cloudflare R2 and load it on demand.

## Trying the build locally

```bash
npm run build
npx serve out        # or: python3 -m http.server -d out 8080
```

Open the printed address (`localhost` counts as secure, so audio and
recording work).
