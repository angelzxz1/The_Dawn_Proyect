// Building blocks shared by the website's pages: layout, type, buttons and
// the dawn motif (a striped half sun).

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { APP_PATH } from "./siteLinks";

export function Container({ className = "", children, ...rest }: ComponentProps<"div">) {
  return (
    <div className={`mx-auto w-full max-w-[1200px] px-[clamp(20px,4vw,40px)] ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`text-[12px] font-semibold uppercase tracking-[2.4px] text-accent ${className}`}>{children}</p>;
}

export const h1Class = "font-display text-[clamp(42px,6.4vw,80px)] font-semibold leading-[1.02] tracking-[-1.4px] text-foreground";
export const h2Class = "font-display text-[clamp(32px,4vw,48px)] font-semibold leading-[1.08] tracking-[-0.6px] text-foreground";
export const leadClass = "text-[17px] leading-[1.6] text-soft";

const buttonBase = "inline-flex min-h-12 items-center justify-center gap-2.5 rounded-[10px] text-[16px] no-underline transition-colors";
export const primaryButton = `${buttonBase} bg-accent px-6 font-semibold text-background hover:bg-accent-strong`;
export const secondaryButton = `${buttonBase} border border-border bg-surface px-[22px] font-medium text-foreground hover:border-border-strong`;

export function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function CheckIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-accent">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** "Open Dawn": the studio, opened in this tab. */
export function OpenDawn({ className = primaryButton, arrow = true, children = "Open Dawn" }: { className?: string; arrow?: boolean; children?: ReactNode }) {
  return (
    <a href={APP_PATH} className={className}>
      {children}
      {arrow && <ArrowIcon />}
    </a>
  );
}

/** A list of points with check marks; `strong` leads each in bold. */
export function CheckList({ items, className = "" }: { items: { strong?: string; text: ReactNode }[]; className?: string }) {
  return (
    <ul className={`flex flex-col gap-3.5 ${className}`}>
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-3 text-[16px] leading-normal text-soft">
          <span className="pt-0.5">
            <CheckIcon />
          </span>
          <span>
            {item.strong && <strong className="font-semibold text-foreground">{item.strong}</strong>} {item.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

const STRIPES: [number, number][] = [
  [35.3, 7.6],
  [86.3, 10.3],
  [141.7, 12.5],
  [202.5, 17.9],
  [270.9, 22.8],
  [344.7, 33.1],
];

/** The dawn: a half sun whose stripes widen toward the horizon. The stripes
 * are cut in the color of what's behind it (`cut`). */
export function Sun({ cut = "fill-background", className = "" }: { cut?: string; className?: string }) {
  return (
    <svg width="100%" viewBox="0 0 760 380" preserveAspectRatio="xMidYMax meet" aria-hidden="true" className={`block ${className}`}>
      <path d="M0 380 A380 380 0 0 1 760 380 Z" className="fill-accent" />
      {STRIPES.map(([y, h]) => (
        <rect key={y} x="0" y={y} width="760" height={h} className={cut} />
      ))}
    </svg>
  );
}

export function Logo({ cut = "fill-background" }: { cut?: string }) {
  return (
    <Link href="/" aria-label="The Dawn Project home" className="flex items-center gap-2.5 no-underline">
      <svg width="26" height="14" viewBox="0 0 26 14" aria-hidden="true">
        <path d="M1 13 A12 12 0 0 1 25 13 Z" className="fill-accent" />
        <rect x="0" y="5.6" width="26" height="1.1" className={cut} />
        <rect x="0" y="9" width="26" height="1.5" className={cut} />
      </svg>
      <span className="font-display text-[19px] font-semibold tracking-[-0.2px] text-foreground">The Dawn Project</span>
    </Link>
  );
}

/** A page's opening: eyebrow, big heading, lead and optional extras. */
export function PageIntro({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead: ReactNode; children?: ReactNode }) {
  return (
    <Container className="flex flex-col gap-[22px] pt-[clamp(40px,6vw,80px)]">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className={`${h1Class} max-w-[940px]`}>{title}</h1>
      <p className={`${leadClass} max-w-[680px] text-[clamp(17px,1.6vw,20px)]`}>{lead}</p>
      {children}
    </Container>
  );
}

/** Jump links to a page's sections, as pills. */
export function JumpLinks({ label, links }: { label: string; links: [string, string][] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2 pt-2.5">
      {links.map(([href, text]) => (
        <a key={href} href={href} className="flex min-h-11 items-center rounded-full border border-border bg-surface px-4 text-[15px] text-foreground no-underline hover:border-accent">
          {text}
        </a>
      ))}
    </nav>
  );
}

/** A section heading block: eyebrow, h2 and an optional lead. */
export function SectionHead({ id, eyebrow, title, lead, className = "" }: { id?: string; eyebrow?: string; title: string; lead?: ReactNode; className?: string }) {
  return (
    <div className={`flex max-w-[680px] flex-col gap-3.5 ${className}`}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 id={id} className={h2Class}>
        {title}
      </h2>
      {lead && <p className={leadClass}>{lead}</p>}
    </div>
  );
}

/** The closing call to action at the bottom of every page. */
export function CtaBand() {
  return (
    <section aria-labelledby="cta-h" className="pt-[110px]">
      <Container>
        <div className="relative flex flex-col items-center gap-5 overflow-hidden rounded-[22px] border border-border bg-surface px-6 pt-[clamp(40px,6vw,72px)] text-center">
          <h2 id="cta-h" className={`${h2Class} text-[clamp(36px,5vw,60px)]`}>
            Plug in. Press record. Share.
          </h2>
          <p className={`${leadClass} max-w-[520px]`}>Open Dawn and turn the idea in your head into a demo you can send tonight.</p>
          <OpenDawn />
          <div className="mt-7 w-[min(560px,90%)]">
            <Sun cut="fill-surface" />
          </div>
        </div>
      </Container>
    </section>
  );
}

/** A card: the site's raised panel. */
export const cardClass = "rounded-xl border border-border bg-surface";
