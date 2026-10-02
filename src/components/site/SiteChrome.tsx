"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { startTelemetry } from "@/lib/telemetry";
import { REPO_URL } from "@/lib/siteLinks";
import { Container, Logo, OpenDawn } from "./ui";

const NAV: [string, string][] = [
  ["/features", "Features"],
  ["/how-it-works", "How it works"],
  ["/faq", "FAQ"],
  ["/support", "Support"],
];

export function SiteHeader() {
  const path = usePathname();
  useEffect(() => {
    // Counts visits to the site too, under the same switch and rules as the app.
    startTelemetry();
  }, []);
  return (
    <Container className="flex items-center justify-between gap-4 py-[22px]">
      <Logo />
      <nav aria-label="Main" className="flex items-center gap-7">
        {NAV.map(([href, label]) => {
          const current = path === href || path === `${href}/`;
          return (
            <Link
              key={href}
              href={href}
              aria-current={current ? "page" : undefined}
              className={`hidden text-[15px] no-underline hover:text-foreground md:inline ${current ? "font-semibold text-foreground" : "text-soft"}`}
            >
              {label}
            </Link>
          );
        })}
        <OpenDawn arrow={false} className="inline-flex min-h-11 items-center justify-center rounded-[10px] bg-accent px-[18px] text-[15px] font-semibold text-background no-underline hover:bg-accent-strong" />
      </nav>
    </Container>
  );
}

export function SiteFooter() {
  const links: [string, string][] = [
    ["/features", "Features"],
    ["/how-it-works", "How it works"],
    ["/faq", "FAQ"],
    ["/support", "Support"],
    ["/credits", "Credits"],
    ["/license", "License"],
    ["/privacy", "Privacy"],
  ];
  return (
    <Container className="flex flex-wrap items-center justify-between gap-5 py-12">
      <div className="flex flex-col gap-2">
        <Logo />
        <span className="text-[14px] text-muted">Built by Angel, one developer. © 2026</span>
      </div>
      <nav aria-label="Footer" className="flex flex-wrap gap-x-[22px] gap-y-2">
        {links.map(([href, label]) => (
          <Link key={href} href={href} className="text-[14px] text-soft no-underline hover:text-foreground">
            {label}
          </Link>
        ))}
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-[14px] text-soft no-underline hover:text-foreground">
          GitHub
        </a>
      </nav>
    </Container>
  );
}
