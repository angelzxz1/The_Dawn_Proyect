import type { Metadata } from "next";
import Link from "next/link";
import { GUIDES } from "@/content/guides";
import { ArrowIcon, Container, CtaBand, PageIntro, cardClass } from "@/site/ui";

export const metadata: Metadata = {
  title: "Guides",
  description: "Detailed guides to The Dawn Project's instruments and effects: what every section and knob is for, and how to use it.",
};

export default function GuidesPage() {
  return (
    <>
      <PageIntro
        eyebrow="Guides"
        title="Every knob, explained."
        lead="In-depth tutorials for Dawn's instruments and effects: what each section is for, what every knob does, and recipes to get you started. More guides are on the way."
      />

      <section aria-label="Guides" className="pt-[72px]">
        <Container className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {GUIDES.map((g) => (
            <Link key={g.slug} href={`/guides/${g.slug}`} className={`${cardClass} group flex flex-col gap-3 p-6 no-underline hover:border-accent`}>
              <span className="text-[11px] font-semibold tracking-[1.6px] text-muted">{g.kind.toUpperCase()}</span>
              <span className="font-display text-[24px] font-semibold text-foreground">{g.name}</span>
              <span className="text-[15px] leading-[1.6] text-soft">{g.summary}</span>
              <span className="mt-auto flex items-center gap-2 pt-2 text-[15px] font-semibold text-accent">
                Read the guide <ArrowIcon />
              </span>
            </Link>
          ))}
        </Container>
      </section>

      <CtaBand />
    </>
  );
}
