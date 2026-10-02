import type { ReactNode } from "react";

export const PRIVACY_UPDATED = "October 2, 2026";
export const ISSUES_URL = "https://github.com/angelzxz1/The_Dawn_Proyect/issues";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
      <div className="flex flex-col gap-1.5 text-[12.5px] leading-relaxed text-muted">{children}</div>
    </section>
  );
}

const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
    {children}
  </a>
);

/** The privacy policy: shown at /privacy and in the app's About window. */
export function PrivacyPolicy({ settingsHint = "in the app, under About → Privacy" }: { settingsHint?: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Section title="The short version">
        <p>
          Dawn has no accounts. Your music, recordings and projects stay on your computer and are never uploaded. To
          learn what to improve, Dawn counts how it's used (for example &ldquo;someone exported an MP3&rdquo;),
          without any audio, project content or personal information, and you can turn that off.
        </p>
      </Section>
      <Section title="Your projects and recordings">
        <p>
          Projects are saved to a folder you choose on your computer, or downloaded as a file. While you work, Dawn
          also keeps an autosave, your presets and your settings in your browser&rsquo;s own storage on this
          computer. Clearing your browser&rsquo;s site data removes them; project folders stay where you saved them.
        </p>
        <p>
          Dawn uses the microphone or audio interface only while a track is armed, monitoring or recording, and only
          after your browser asks for permission. Sound is processed in your browser and never sent anywhere.
        </p>
      </Section>
      <Section title="Usage statistics">
        <p>
          Page visits are counted with Cloudflare Web Analytics, which uses no cookies and doesn&rsquo;t follow you
          across other sites. Dawn also counts actions such as opening the app, choosing a template, starting a
          recording, loading an amp model or exporting a song, with at most a detail like the export format.
        </p>
        <p>
          These counts never include audio, MIDI, project or track names, file names, or anything you type, and
          they aren&rsquo;t linked to who you are. You can switch them off {settingsHint}. Dawn also sends none
          when your browser asks sites not to track you (Do Not Track or Global Privacy Control).
        </p>
      </Section>
      <Section title="Error reports">
        <p>
          When something breaks, Dawn can send an error report to Sentry: the error message, where in Dawn&rsquo;s
          code it happened, and your browser and operating system. Reports never include audio or project files,
          and they follow the same switch as usage statistics.
        </p>
      </Section>
      <Section title="Other sites">
        <p>
          The piano&rsquo;s samples are downloaded from the Tone.js website (hosted by GitHub Pages), which sees
          your IP address like any website you visit. Links to support pages, Discord or GitHub take you to those
          sites, which have their own privacy policies.
        </p>
      </Section>
      <Section title="Questions">
        <p>
          Ask in the <A href={ISSUES_URL}>project&rsquo;s GitHub issues</A>. If this policy changes, the date below
          changes with it.
        </p>
        <p className="text-[11.5px]">Last updated {PRIVACY_UPDATED}.</p>
      </Section>
    </div>
  );
}
