// The guides' layout (/guides/<slug>): a contents list beside the page, and
// each section's text, steps, control lists, recipes and tips.

import type { ReactNode } from "react";
import type { GuideControl, GuideGroup, GuideRecipe, GuideSection } from "@/content/guides";
import { CheckIcon, Eyebrow, cardClass } from "./ui";

/** The page's sections as links: a sticky column on wide screens. */
export function GuideContents({ sections }: { sections: GuideSection[] }) {
  return (
    <nav aria-label="Contents" className="lg:sticky lg:top-6 lg:max-h-[calc(100vh-48px)] lg:overflow-y-auto">
      <p className="pb-3 text-[11px] font-semibold tracking-[1.6px] text-muted">CONTENTS</p>
      <ol className="flex flex-wrap gap-2 lg:flex-col lg:gap-0.5">
        {sections.map((s, i) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className="flex min-h-10 items-center gap-2.5 rounded-full border border-border bg-surface px-3.5 text-[14px] text-soft no-underline hover:border-accent hover:text-foreground lg:min-h-9 lg:rounded-lg lg:border-transparent lg:bg-transparent lg:px-2.5 lg:hover:border-transparent lg:hover:bg-surface"
            >
              <span className="hidden w-5 font-code text-[11px] text-muted lg:inline">{String(i + 1).padStart(2, "0")}</span>
              {s.nav ?? s.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Controls({ controls }: { controls: GuideControl[] }) {
  return (
    <dl className={`${cardClass} divide-y divide-border`}>
      {controls.map((c) => (
        <div key={c.name} className="grid gap-x-6 gap-y-1.5 px-4 py-3.5 sm:grid-cols-[200px_1fr]">
          <dt className="flex flex-col gap-1">
            <span className="text-[15.5px] font-semibold text-foreground">{c.name}</span>
            {c.range && <span className="font-code text-[11.5px] leading-snug text-muted">{c.range}</span>}
          </dt>
          <dd className="text-[15px] leading-[1.6] text-soft">{c.text}</dd>
        </div>
      ))}
    </dl>
  );
}

function Group({ group }: { group: GuideGroup }) {
  return (
    <div className="flex flex-col gap-3">
      {group.title && <h3 className="font-display text-[20px] font-semibold text-foreground">{group.title}</h3>}
      {group.lead && <p className="text-[15.5px] leading-[1.6] text-soft">{group.lead}</p>}
      <Controls controls={group.controls} />
    </div>
  );
}

function Steps({ steps }: { steps: { title: string; text: string }[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((s, i) => (
        <li key={s.title} className={`${cardClass} flex gap-4 p-4`}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-glow font-code text-[13px] font-semibold text-accent">{i + 1}</span>
          <div className="flex flex-col gap-1">
            <strong className="text-[16px] font-semibold text-foreground">{s.title}</strong>
            <span className="text-[15px] leading-[1.6] text-soft">{s.text}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Recipe({ recipe }: { recipe: GuideRecipe }) {
  return (
    <div className={`${cardClass} flex flex-col gap-3 p-5`}>
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-[20px] font-semibold text-foreground">{recipe.title}</h3>
        <p className="text-[14.5px] text-muted">{recipe.sound}</p>
      </div>
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-[15px] leading-[1.6] text-soft marker:font-code marker:text-[12px] marker:text-accent">
        {recipe.steps.map((s) => (
          <li key={s} className="pl-1">
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Tips({ tips }: { tips: string[] }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-accent/40 bg-glow p-4">
      <p className="text-[11px] font-semibold tracking-[1.6px] text-accent">TIPS</p>
      <ul className="flex flex-col gap-2">
        {tips.map((t) => (
          <li key={t} className="flex items-start gap-2.5 text-[15px] leading-[1.55] text-soft">
            <span className="pt-0.5">
              <CheckIcon size={16} />
            </span>
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One section of a guide. `children` goes after its text (for pictures and lists of its own). */
export function GuideSectionView({ section, index, children }: { section: GuideSection; index: number; children?: ReactNode }) {
  const h = `${section.id}-h`;
  return (
    <section id={section.id} aria-labelledby={h} className="flex scroll-mt-6 flex-col gap-5 border-t border-border pt-12 first:border-t-0 first:pt-0">
      <div className="flex max-w-[720px] flex-col gap-3">
        <Eyebrow>{String(index + 1).padStart(2, "0")}</Eyebrow>
        <h2 id={h} className="font-display text-[clamp(28px,3vw,38px)] font-semibold leading-[1.1] tracking-[-0.4px] text-foreground">
          {section.title}
        </h2>
        <p className="text-[17px] leading-[1.6] text-soft">{section.lead}</p>
      </div>
      {section.paragraphs?.map((p) => (
        <p key={p} className="max-w-[720px] text-[16px] leading-[1.65] text-soft">
          {p}
        </p>
      ))}
      {section.steps && <Steps steps={section.steps} />}
      {children}
      {section.groups?.map((g, i) => (
        <Group key={g.title ?? i} group={g} />
      ))}
      {section.recipes && (
        <div className="grid gap-4 md:grid-cols-2">
          {section.recipes.map((r) => (
            <Recipe key={r.title} recipe={r} />
          ))}
        </div>
      )}
      {section.tips && <Tips tips={section.tips} />}
    </section>
  );
}
