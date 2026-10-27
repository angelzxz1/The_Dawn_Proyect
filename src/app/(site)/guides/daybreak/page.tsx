import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { DAYBREAK_PRESET_NOTES, DAYBREAK_SECTIONS, PRESET_CATEGORY_NOTES } from "@/content/daybreakGuide";
import { FACTORY_SYNTH_PRESETS, PRESET_CATEGORIES } from "@/instruments/synth/synthPresets";
import { GuideContents, GuideSectionView } from "@/site/guide";
import { Container, CtaBand, OpenDawn, PageIntro, cardClass } from "@/site/ui";

export const metadata: Metadata = {
  title: "Daybreak guide",
  description: "A complete guide to Daybreak, The Dawn Project's wavetable synth: every panel and knob, modulation, recipes and the presets.",
};

function FlowBox({ title, sub, accent = false }: { title: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`flex flex-col gap-0.5 rounded-lg border px-3 py-2 ${accent ? "border-accent bg-glow" : "border-border bg-background"}`}>
      <span className="text-[14px] font-semibold text-foreground">{title}</span>
      {sub && <span className="text-[12px] leading-snug text-muted">{sub}</span>}
    </div>
  );
}

function FlowColumn({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-semibold tracking-[1.6px] text-muted">{label}</span>
      {children}
    </div>
  );
}

function Arrow() {
  return (
    <span aria-hidden="true" className="flex items-center justify-center text-[20px] text-accent md:pt-6">
      <span className="md:hidden">↓</span>
      <span className="hidden md:inline">→</span>
    </span>
  );
}

/** One voice's path, sources to output, with the modulators beneath. */
function SignalFlow() {
  return (
    <figure className={`${cardClass} flex flex-col gap-5 p-[clamp(16px,3vw,28px)]`}>
      <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
        <FlowColumn label="SOURCES">
          <FlowBox title="Osc 1" sub="wavetable, warp, unison" />
          <FlowBox title="Osc 2" sub="wavetable, warp, unison" />
          <FlowBox title="Sub" sub="up to 2 octaves down" />
          <FlowBox title="Noise" sub="white or pink" />
        </FlowColumn>
        <Arrow />
        <FlowColumn label="FILTERS · EACH SOURCE'S “TO”">
          <FlowBox title="Filter 1" />
          <span className="text-center font-code text-[11px] text-muted">1 → 2 serial · 1 | 2 parallel</span>
          <FlowBox title="Filter 2" />
          <FlowBox title="Out" sub="skips the filters" />
        </FlowColumn>
        <Arrow />
        <FlowColumn label="OUTPUT">
          <FlowBox title="Env 1 · Amp" sub="each note's loudness" />
          <FlowBox title="Volume" sub="the whole synth" accent />
        </FlowColumn>
      </div>
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-[11px] font-semibold tracking-[1.6px] text-muted">MODULATORS · DRAG ONTO ANY KNOB THAT CAN BE MODULATED</span>
        <div className="flex flex-wrap gap-1.5">
          {["Env 2", "Env 3", "LFO 1", "LFO 2", "LFO 3", "Velocity", "Note", "Mod Wheel", "Pitch Bend", "Random", "Macros 1–4"].map((m) => (
            <span key={m} className="rounded-full border border-border bg-background px-2.5 py-1 text-[12.5px] text-soft">
              {m}
            </span>
          ))}
        </div>
      </div>
      <figcaption className="sr-only">Sources go to the filters or straight out, then through the amp envelope and the volume. Modulators can move the knobs along the way.</figcaption>
    </figure>
  );
}

function MapCell({ href, title, sub, className = "" }: { href: string; title: string; sub: string; className?: string }) {
  return (
    <a href={href} className={`flex flex-col justify-center gap-0.5 rounded-lg border border-border bg-background px-3 py-2.5 no-underline hover:border-accent ${className}`}>
      <span className="text-[14px] font-semibold text-foreground">{title}</span>
      <span className="text-[12px] leading-snug text-muted">{sub}</span>
    </a>
  );
}

/** The window's layout, each panel a link to its section. */
function WindowMap() {
  return (
    <figure className={`${cardClass} flex flex-col gap-2 p-[clamp(12px,2vw,20px)]`}>
      <MapCell href="#header" title="Header" sub="Presets · Synth / Matrix · voices · scope · Volume" />
      <div className="grid gap-2 md:grid-cols-[1.7fr_1fr_0.75fr]">
        <div className="grid gap-2">
          <MapCell href="#oscillators" title="Osc 1" sub="Wavetable, warp and unison" className="md:min-h-[88px]" />
          <MapCell href="#oscillators" title="Osc 2" sub="The same, and the partner for FM and Ring" className="md:min-h-[88px]" />
        </div>
        <div className="grid gap-2">
          <MapCell href="#filters" title="Filter 1" sub="Type, cutoff, resonance" />
          <MapCell href="#filters" title="Filter 2" sub="Plus the 1 → 2 / 1 | 2 switch" />
        </div>
        <div className="grid gap-2">
          <MapCell href="#sub-noise" title="Sub" sub="Low end" />
          <MapCell href="#sub-noise" title="Noise" sub="Air" />
          <MapCell href="#voice" title="Voice" sub="Poly, glide, bend" />
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-[1.7fr_1fr_0.75fr]">
        <MapCell href="#envelopes" title="Envelopes" sub="Env 1 · Amp, Env 2, Env 3" className="md:min-h-[96px]" />
        <MapCell href="#lfos" title="LFOs" sub="LFO 1, 2 and 3" />
        <MapCell href="#sources-macros" title="Sources" sub="Velocity, note, wheels, random, macros" />
      </div>
      <figcaption className="pt-1 text-[13px] text-muted">The Synth page, laid out as in the window. Click a panel to read about it. The Matrix page is covered under Modulation.</figcaption>
    </figure>
  );
}

function PresetList() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {PRESET_CATEGORIES.map((cat) => {
        const presets = FACTORY_SYNTH_PRESETS.filter((p) => p.category === cat && p.name !== "Init");
        return (
          <div key={cat} className={`${cardClass} flex flex-col gap-3 p-5`}>
            <div className="flex flex-col gap-0.5">
              <h3 className="font-display text-[20px] font-semibold text-foreground">{cat}</h3>
              <p className="text-[14px] text-muted">{PRESET_CATEGORY_NOTES[cat]}</p>
            </div>
            <dl className="flex flex-col gap-2.5">
              {presets.map((p) => (
                <div key={p.id} className="flex flex-col gap-0.5">
                  <dt className="text-[15px] font-semibold text-foreground">{p.name}</dt>
                  <dd className="text-[14.5px] leading-normal text-soft">{DAYBREAK_PRESET_NOTES[p.name]}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </div>
  );
}

/** Pictures and lists that go with a section, after its text. */
const EXTRAS: Record<string, ReactNode> = {
  "signal-flow": (
    <>
      <SignalFlow />
      <WindowMap />
    </>
  ),
  presets: <PresetList />,
};

export default function DaybreakGuidePage() {
  return (
    <>
      <PageIntro
        eyebrow="Guide · Instrument"
        title="Daybreak, knob by knob."
        lead="Daybreak is Dawn's wavetable synth. This guide walks through every panel and every knob: what it's for, how to use it, and recipes to build your own sounds."
      >
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <OpenDawn>Open Dawn and follow along</OpenDawn>
          <Link href="/guides" className="text-[15px] text-soft hover:text-foreground">
            All guides
          </Link>
        </div>
      </PageIntro>

      <Container className="grid gap-10 pt-[72px] lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-14">
        <aside>
          <GuideContents sections={DAYBREAK_SECTIONS} />
        </aside>
        <div className="flex min-w-0 flex-col gap-12">
          {DAYBREAK_SECTIONS.map((s, i) => (
            <GuideSectionView key={s.id} section={s} index={i}>
              {EXTRAS[s.id]}
            </GuideSectionView>
          ))}
        </div>
      </Container>

      <CtaBand />
    </>
  );
}
