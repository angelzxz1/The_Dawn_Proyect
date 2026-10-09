# Deploying Dawn

Dawn is a static site: the website at `/` (landing, Features, How it works,
FAQ, Support, Credits, License, Privacy) and the studio itself at `/app`.
`npm run build` produces it as plain files in `out/` (Next's
`output: "export"`). Any static host can serve it; the steps
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
4. Connect your domain (next section). HTTPS is automatic, and Dawn needs
   it: AudioWorklets, the microphone and saving project folders only work
   on HTTPS (or `localhost`).

## Your own domain

1. **Buy it** in the Cloudflare dashboard: **Domain Registration → Register
   Domains**. A domain bought there already uses Cloudflare's DNS, so
   there's nothing to point anywhere.
2. **Attach it to the site:** **Workers & Pages →** your project **→ Custom
   domains → Set up a custom domain**, enter the bare domain (for example
   `dawnproject.app`) and confirm. Cloudflare adds the DNS record and the
   HTTPS certificate itself; the domain shows **Active** after a few
   minutes.
3. **Add `www` too:** set up `www.dawnproject.app` the same way, then send
   it to the bare domain: **your domain → Rules → Redirect Rules → Create
   rule →** the "Redirect from WWW to root" template. One address keeps
   saved projects, installs and analytics in one place.
4. **Tell Dawn its address:** **Settings → Variables and Secrets →**
   `NEXT_PUBLIC_SITE_URL` = `https://dawnproject.app` (Production), then
   **Deployments → ⋯ → Retry deployment**. Every `NEXT_PUBLIC_` variable is
   built into the site, so a change only shows after a new deployment.
5. **An address for email** without exposing yours: **your domain → Email →
   Email Routing**, add `hello@dawnproject.app` and forward it to your own
   inbox.

Keep using that one address from launch on: the browser keeps each
person's autosave, presets and installed packs per address, so moving to
a new domain later would make them start empty.

`public/_headers` is copied into `out/` and sets the caching rules (a year
for hashed build files, a day for the amp engine), the `.wasm` content type,
and permission for the microphone and MIDI.

Dawn doesn't use `SharedArrayBuffer`, so it doesn't need cross-origin
isolation headers (COOP/COEP). Don't add them: they would block the piano
samples, which load from another site.

## Usage statistics and error reports

Nothing is collected unless you set these environment variables in the
Cloudflare Pages project (Settings → Variables), then redeploy. Each is
optional; set only the services you use.

### Step by step

1. **Page views, Cloudflare Web Analytics (free).** Dashboard → **Analytics
   & Logs → Web Analytics → Add a site**, enter your domain and pick the
   **manual setup (JS snippet)**. From the snippet, copy only the `token`
   value into `NEXT_PUBLIC_CF_BEACON_TOKEN`. Don't use the "automatic setup"
   on the Pages project: it injects the script into every page and ignores
   the in-app switch that lets people turn statistics off.
2. **Product events, Umami Cloud (free hobby plan).** Sign up at
   [cloud.umami.is](https://cloud.umami.is), **Add website** with your
   domain, then copy its **Website ID** into `NEXT_PUBLIC_UMAMI_WEBSITE_ID`.
   The events listed below show up under **Events**; `sound_made` over
   `app_opened` is your activation rate, `export_completed` over
   `sound_made` your demo rate.
3. **Error reports, Sentry (free developer plan).** At
   [sentry.io](https://sentry.io), **Create Project → Browser JavaScript**,
   name it `dawn`. Copy the DSN from **Project Settings → Client Keys** into
   `NEXT_PUBLIC_SENTRY_DSN` (it's meant to be public). Then, in **Project
   Settings → Security & Privacy**, put your domain in **Allowed Domains**
   (so no one else can send reports to it) and turn on **Prevent Storing of
   IP Addresses** (the privacy policy promises reports aren't linked to
   people).
4. **Add the variables** in Pages: **Settings → Variables and Secrets**, for
   **Production** only (so your preview deployments don't count as
   visits), then **Deployments → ⋯ → Retry deployment**.
5. **Check it works:** open your site in a normal (not private) window,
   play a note, and watch Umami's realtime view for `app_opened` and
   `sound_made`. Open `https://your-domain/?test-error` once: a "Test error
   from The Dawn Project" appears in Sentry within a minute. If your own
   browser sends Do Not Track, Dawn sends nothing; check from a browser
   that doesn't.

| Variable | What it turns on |
| --- | --- |
| `NEXT_PUBLIC_CF_BEACON_TOKEN` | Cloudflare Web Analytics page views (or turn on Web Analytics for the Pages project in the dashboard instead, which needs no code) |
| `NEXT_PUBLIC_UMAMI_WEBSITE_ID` | Product events through Umami. `NEXT_PUBLIC_UMAMI_SRC` points at a self-hosted Umami's `script.js` (default: Umami Cloud) |
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | Product events through Plausible instead. `NEXT_PUBLIC_PLAUSIBLE_SRC` overrides the script address |
| `NEXT_PUBLIC_SENTRY_DSN` | Error reports to Sentry (a project's DSN, from its Client Keys settings) |

The events, their properties, and what they answer:

| Event | Properties | Question |
| --- | --- | --- |
| `app_opened` | `returning` | How many people come, and do they come back? |
| `template_chosen` | `template` | Which starting points do people want? |
| `sound_made` | `via`: `note`, `playback` or `input` | Did a new visitor get to sound? (activation; once per visit) |
| `recording_started` | `kind`: `audio` or `midi` | Are people recording? |
| `nam_model_loaded`, `ir_loaded` | `via` | Is the guitar hook used? |
| `export_completed` | `format` | Did they finish a demo? |
| `project_saved` | `target`: `folder` or `file` | Are they investing in Dawn? |
| `pack_imported` | | Are packs reaching people? |
| `support_link_clicked`, `feedback_opened` | `where` | Is the support ask visible? |
| `error_shown` | `area` | What's breaking? |

`src/lib/telemetry.ts` only accepts these property names, each holding a
short code, so names, paths and typed text can't end up in an event. Error
reports carry the error message with file names and quoted text removed,
the stack, the browser string and the release, and at most ten are sent per
visit. People can switch both off in **About → Privacy**, and nothing is
sent when the browser sends Do Not Track or Global Privacy Control. If you
change what's collected, update the privacy policy
(`src/site/PrivacyPolicy.tsx`) and its date.

## Support, community and feedback links

These are optional too. A Support button (in the header, the About window and
the note after an export) appears once at least one page is set, and the
Discord button once its invite is. Use full `https://` addresses.

On the website, the membership buttons go to the Patreon page and read
"Memberships open soon" until it's set; the Ko-fi, GitHub Sponsors and
Discord buttons only appear once theirs are set. Keep the tiers and prices in
`src/content/tiers.ts` in step with Patreon.

| Variable | Page |
| --- | --- |
| `NEXT_PUBLIC_PATREON_URL` | Patreon (shown first) |
| `NEXT_PUBLIC_GITHUB_SPONSORS_URL` | GitHub Sponsors |
| `NEXT_PUBLIC_KOFI_URL` | Ko-fi |
| `NEXT_PUBLIC_DISCORD_URL` | The Discord invite |
| `NEXT_PUBLIC_DEMO_VIDEO_URL` | The 60-second demo video (YouTube or similar). The landing page's "Watch the demo" button and video card only show once it's set. |
| `NEXT_PUBLIC_FEEDBACK_URL` | A feedback form (Tally, Google Forms…). Dawn adds `browser` and `version` query parameters, which Tally can use as hidden fields. Without it, **Feedback** opens a new GitHub issue with the same details filled in. |
| `NEXT_PUBLIC_CONTACT_EMAIL` | An address people can write to, for example `hello@thedawnproject.app`. The Support page's **Share your tones** opens an email to it (creators send files and permission that way); without it, that card goes to the Discord, or else GitHub. |

After an export, Dawn thanks the person and offers the first support page,
at most once per visit and never in the way of the download.

## The demo song

The plan's first-run experience opens a demo song on the very first visit.
To add it: make the song in Dawn, choose **File → Export Project File…**, and
put the file at `public/demo/demo-song.dawnproject` (the name matters). The
start screen then offers "Listen to the demo song" (from the next build, or after restarting `npm run dev`), the first visit loads it
behind the welcome screen, and File → New offers to open it again. Without
the file, none of that shows. Keep it small (a minute or so; recordings make
the file bigger) since every first visit downloads it.

## Search engines

`sitemap.xml` and `robots.txt` are generated from `NEXT_PUBLIC_SITE_URL`, so
set it before the first public deploy. The studio (`/app`) is kept out of
search results. Unknown addresses get the site's "page not found" page
(`404.html`).

## Release notes

`src/content/whatsNew.ts` holds the **What's new** notes. With each release,
add an entry and bump `version` in `package.json` to match (a test checks
they agree); people who used an older version see the notes once.

## Installable app (PWA)

`src/app/manifest.ts` makes Dawn installable, with icons in `public/icons/`.
`npm run build` first runs `scripts/build-sw.mjs`, which writes
`public/sw.js` from `scripts/sw.template.js` with a new build id, so every
deploy ships a new service worker and open copies of Dawn show the reload
prompt. The worker only runs in production builds (not `npm run dev`), and
`_headers` makes browsers always re-check `/sw.js`. The installed app opens
on the studio (`/app`); copies installed before the website existed open `/`
and are sent on to `/app`.

## Large files

Cloudflare Pages refuses files over 25 MiB. Put anything bigger (long
sample libraries, for example) on Cloudflare R2 and load it on demand.

## Trying the build locally

```bash
npm run build
npx serve out
```

Use `serve` (or another server that maps `/features` to `features.html`, as
Cloudflare Pages does); a bare file server only finds the pages with `.html`.

Open the printed address (`localhost` counts as secure, so audio and
recording work).
