"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ExternalLink, X } from "lucide-react";
import { CREDIT_KINDS, creditsOfKind } from "@/lib/credits";
import { PrivacyPolicy } from "./PrivacyPolicy";
import { SupportSection, WhatsNew } from "./SupportViews";

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
export const REPO_URL = "https://github.com/angelzxz1/The_Dawn_Proyect";
const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE.md`;

export type AboutTab = "about" | "news" | "credits" | "privacy" | "license";

const TABS: { id: AboutTab; label: string }[] = [
  { id: "about", label: "About" },
  { id: "news", label: "What's new" },
  { id: "credits", label: "Credits" },
  { id: "privacy", label: "Privacy" },
  { id: "license", label: "License" },
];

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

function AboutTabBody({ extra }: { extra?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 text-[12.5px] leading-relaxed text-muted">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-icon.png" alt="" className="h-12 w-12 rounded-xl" />
        <div>
          <p className="text-base font-semibold text-foreground">The Dawn Project</p>
          <p className="font-mono text-[11px]">Version {APP_VERSION}</p>
        </div>
      </div>
      <p className="text-foreground">
        A studio in a tab: record, amp up your guitar, make beats and finish your demo. Nothing to install, no plugins
        to buy, and no account: your projects are saved as folders on your computer.
      </p>
      <p>
        Dawn is free and made by one developer. Every effect, instrument and the sound engine run inside your browser.
        It works best in Chrome or Edge on a desktop computer; recording latency depends on your audio interface and
        computer.
      </p>
      {extra}
      <p>
        Source code and bug reports: <Link href={REPO_URL}>GitHub</Link>.
      </p>
    </div>
  );
}

function CreditsTabBody() {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[12.5px] leading-relaxed text-muted">
        Dawn is built on the work of these people and projects. Thank you.
      </p>
      {CREDIT_KINDS.map(({ kind, title }) => {
        const list = creditsOfKind(kind);
        if (list.length === 0) return null;
        return (
          <section key={kind} className="flex flex-col gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
            <ul className="flex flex-col gap-2">
              {list.map((c) => (
                <li key={c.id} className="rounded-lg border border-border bg-surface px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-[13px] font-medium text-foreground">
                      {c.url ? <Link href={c.url}>{c.name}</Link> : c.name}
                    </span>
                    <span className="font-mono text-[10.5px] text-muted">
                      {c.licenseUrl ? <Link href={c.licenseUrl}>{c.license}</Link> : c.license}
                    </span>
                  </div>
                  <p className="text-[11.5px] text-muted">
                    {c.author} · {c.usedFor}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function LicenseTabBody() {
  return (
    <div className="flex flex-col gap-3 text-[12.5px] leading-relaxed text-muted">
      <p className="text-foreground">
        <strong>Your music is yours.</strong> Use Dawn to make, record, mix and export music, and use, share, publish or
        sell what you make for any purpose, commercial or not, with no payment or credit required.
      </p>
      <p>
        The app itself is &copy; 2026 Angel Fernando Zu&ntilde;iga Navarro, all rights reserved. Its code, and the sounds
        and presets made for it, aren&rsquo;t licensed for use: copying, modifying, hosting or redistributing them needs
        written permission. You can use Dawn&rsquo;s built-in sounds in your music, but not pass them on by themselves
        as a sample pack or preset bank.
      </p>
      <p>
        The libraries, fonts and sounds listed under Credits keep their own licenses. The full terms are in{" "}
        <Link href={LICENSE_URL}>LICENSE.md</Link>.
      </p>
    </div>
  );
}

/** About, Credits, Privacy and License, opened from the header. */
export function AboutWindow({
  initialTab = "about",
  onClose,
  aboutExtra,
  privacyExtra,
}: {
  initialTab?: AboutTab;
  onClose: () => void;
  /** More for the About tab (support links). */
  aboutExtra?: ReactNode;
  /** Settings shown above the privacy policy. */
  privacyExtra?: ReactNode;
}) {
  const [tab, setTab] = useState<AboutTab>(initialTab);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-label="About The Dawn Project"
        className="flex max-h-full w-[560px] max-w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 pt-3">
          <div role="tablist" className="flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`-mb-px border-b-2 px-3 pb-2 text-[13px] ${tab === t.id ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="mb-2 flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-surface">
            <X size={15} />
          </button>
        </div>
        <div className="overflow-y-auto p-5">
          {tab === "about" && <AboutTabBody extra={aboutExtra ?? <SupportSection />} />}
          {tab === "news" && <WhatsNew />}
          {tab === "credits" && <CreditsTabBody />}
          {tab === "privacy" && (
            <div className="flex flex-col gap-5">
              {privacyExtra}
              <PrivacyPolicy settingsHint="with the switch above" />
              <p className="text-[11.5px] text-muted">
                Also at <Link href="/privacy">/privacy <ExternalLink size={10} /></Link>
              </p>
            </div>
          )}
          {tab === "license" && <LicenseTabBody />}
        </div>
      </div>
    </div>
  );
}
