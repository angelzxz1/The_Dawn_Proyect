import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { LANDING_FAQ_IDS } from "@/content/faq";
import { TIERS } from "@/content/tiers";
import { ChainChips, EqCurve, FileTree } from "@/site/illustrations";
import { FaqAccordion, OpenStudioIfInstalled, Tiers } from "@/site/interactive";
import { CheckIcon, Container, CtaBand, Eyebrow, OpenDawn, SectionHead, Sun, h2Class, leadClass, secondaryButton } from "@/site/ui";
import { DEMO_VIDEO_URL, supportLink } from "@/site/siteLinks";

export const metadata: Metadata = {
  title: { absolute: "The Dawn Project — Your studio, one tab away" },
  description:
    "Record guitar through real amp models, make beats, mix with 18 studio effects and export your song, in a browser tab. Free, with nothing to install and no account.",
};

const HIGHLIGHTS: [string, string][] = [
  ["18", "built-in studio effects, with sidechain and automation"],
  ["NAM + IRs", "real amp models and cabinets in a browser tab"],
  ["0", "installs, plugins or accounts needed"],
];

const STEPS: [string, string][] = [
  ["Pick a template", "Guitar demo, Beat, Voice + guitar, or an empty project. Every template makes sound within three clicks."],
  ["Record", "Count-in, metronome, loop and latency alignment, so your takes land on the beat."],
  ["Export and share", "MP3 for your band chat, WAV for quality, stems and MIDI for your main DAW."],
];

const NEEDS: [string, string][] = [
  ["Chrome or Edge on a desktop computer", "Other browsers work with some limits."],
  ["Wired headphones", "Bluetooth adds a lot of delay when you play live."],
  ["An audio interface or USB guitar cable", "To record guitar or a microphone."],
  ["A setup guide that explains latency", "Delay depends on your hardware. The guide helps you set it up."],
];

function PlayIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 4.5v15l13-7.5z" />
    </svg>
  );
}

function FeatureCard({ eyebrow, title, text, children }: { eyebrow: string; title: string; text: string; children: ReactNode }) {
  return (
    <article className="flex flex-col gap-3.5 rounded-2xl border border-border bg-surface p-[26px]">
      <div className="flex h-[168px] items-center justify-center overflow-hidden rounded-[10px] border border-border bg-background p-4">{children}</div>
      <Eyebrow className="pt-1.5 text-[11px]">{eyebrow}</Eyebrow>
      <h3 className="font-display text-[24px] font-semibold leading-[1.2] text-foreground">{title}</h3>
      <p className="text-[16px] leading-[1.6] text-soft">{text}</p>
    </article>
  );
}

export default function Home() {
  const others: [string, string][] = (
    [
      ["github", "GitHub Sponsors"],
      ["kofi", "Ko-fi"],
      ["discord", "Join the Discord"],
    ] as const
  )
    .map(([id, label]): [string, string] => [supportLink(id), label])
    .filter(([url]) => url);

  return (
    <>
      <OpenStudioIfInstalled />
      <section id="top" className="relative overflow-hidden pt-[clamp(40px,7vw,88px)]">
        <Container className="flex flex-col items-center gap-6 text-center">
          <Eyebrow>Free · Runs in your browser</Eyebrow>
          <h1 className="max-w-[900px] font-display text-[clamp(44px,7.4vw,92px)] font-semibold leading-none tracking-[-1.6px] text-foreground">
            Your studio, one tab away.
          </h1>
          <p className={`${leadClass} max-w-[640px] text-[clamp(17px,1.6vw,20px)]`}>
            Record guitar through real amp models, make beats, mix with 18 studio effects and export your song. Nothing to install, no plugins to buy, no account.
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-1">
            <OpenDawn />
            {DEMO_VIDEO_URL && (
              <a href={DEMO_VIDEO_URL} target="_blank" rel="noreferrer" className={secondaryButton}>
                <PlayIcon /> Watch the 60-second demo
              </a>
            )}
          </div>
          <p className="text-[13px] text-muted">Works best in Chrome or Edge on a desktop computer.</p>
        </Container>
        <Container className="relative mt-[clamp(32px,5vw,56px)]">
          <div className="mx-auto w-[min(760px,88%)]">
            <Sun />
          </div>
          <div className="relative -mt-[clamp(50px,11vw,150px)] overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-[0_40px_120px_-20px_rgba(0,0,0,0.7)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/site/studio.webp"
              width={2400}
              height={1350}
              alt="The Dawn Project studio: drums and a guitar take in the arrangement, with a gate, saturator, cabinet and EQ in the guitar’s effects rack"
              className="block h-auto w-full"
            />
          </div>
        </Container>
      </section>

      <section aria-label="Highlights" className="pb-6 pt-14">
        <Container>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-px overflow-hidden rounded-[14px] border border-border bg-border">
            {HIGHLIGHTS.map(([big, small]) => (
              <div key={big} className="flex flex-col gap-1.5 bg-background px-[26px] py-6">
                <div className="font-display text-[30px] font-semibold text-foreground">{big}</div>
                <div className="text-[15px] text-soft">{small}</div>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section id="features" className="pb-8 pt-24">
        <Container className="flex flex-col gap-10">
          <div className="flex max-w-[680px] flex-col gap-3.5">
            <SectionHead
              eyebrow="What's inside"
              title="Everything you need to finish the demo."
              lead="Dawn is a fast sketchpad that goes surprisingly far. Capture the idea, make it sound good, and take it anywhere."
            />
            <Link href="/features" className="text-[16px] font-semibold text-accent no-underline hover:text-accent-strong">
              See every feature →
            </Link>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-5">
            <FeatureCard
              eyebrow="Guitar tones"
              title="Plug in and play through a real amp."
              text="Neural amp models (NAM) and cabinet impulse responses run right in the tab. Start from the built-in tones or load your own .nam captures and IRs."
            >
              <ChainChips items={["Gate", "NAM Amp", "Cabinet IR", "EQ", "Reverb"]} hot={["NAM Amp", "Cabinet IR"]} />
            </FeatureCard>
            <FeatureCard
              eyebrow="Studio effects"
              title="18 effects, no plugins to buy."
              text="A 24-band EQ with mid/side, compressors, multiband dynamics and a saturator. Sidechain the kick to the bass in two clicks, and automate any knob."
            >
              <EqCurve />
            </FeatureCard>
            <FeatureCard
              eyebrow="Your files"
              title="No account. No cloud. Yours."
              text="Projects save as folders on your computer, with your undo history. Take stems and MIDI to any other DAW whenever you like."
            >
              <FileTree
                lines={[
                  { text: "▾ Late Night Riff/", depth: 0 },
                  { text: "project.json", depth: 1 },
                  { text: "history.json", depth: 1 },
                  { text: "▾ audio/", depth: 1 },
                  { text: "guitar-take-3.wav", depth: 2 },
                  { text: "vocals-take-1.wav", depth: 2 },
                ]}
              />
            </FeatureCard>
          </div>
        </Container>
      </section>

      <section id="how" className="pt-24">
        <Container className="flex flex-col gap-10">
          <SectionHead eyebrow="How it works" title="Idea to demo before the idea fades." />
          <ol className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-5">
            {STEPS.map(([title, text], i) => (
              <li key={title} className={`flex flex-col gap-2.5 border-t-2 pt-6 ${i === 0 ? "border-accent" : "border-border-strong"}`}>
                <span className="font-code text-[13px] text-accent">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="font-display text-[24px] font-semibold text-foreground">{title}</h3>
                <p className="text-[16px] leading-[1.6] text-soft">{text}</p>
              </li>
            ))}
          </ol>
          <Link href="/how-it-works" className="self-start text-[16px] font-semibold text-accent no-underline hover:text-accent-strong">
            Read the walkthrough and setup guides →
          </Link>
          {DEMO_VIDEO_URL && (
            <a
              id="video"
              href={DEMO_VIDEO_URL}
              target="_blank"
              rel="noreferrer"
              className="relative flex aspect-video max-h-[560px] w-full items-center justify-center overflow-hidden rounded-2xl border border-border bg-surface no-underline"
            >
              <div className="absolute bottom-0 left-1/2 w-[70%] -translate-x-1/2 opacity-[0.18]">
                <Sun cut="fill-surface" />
              </div>
              <div className="relative flex flex-col items-center gap-3.5 p-5 text-center">
                <span className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-accent text-background">
                  <PlayIcon size={26} />
                </span>
                <span className="text-[15px] text-soft">Watch the 60-second demo: a riff, a groove, a mix and an MP3, all in a browser tab</span>
              </div>
            </a>
          )}
        </Container>
      </section>

      <section aria-labelledby="req-h" className="pb-8 pt-24">
        <Container>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-8 rounded-[18px] border border-border bg-surface p-[clamp(24px,4vw,44px)]">
            <div className="flex flex-col gap-3.5">
              <Eyebrow>Honest requirements</Eyebrow>
              <h2 id="req-h" className={`${h2Class} text-[clamp(28px,3vw,38px)]`}>
                What you need to get the best out of Dawn.
              </h2>
            </div>
            <ul className="flex flex-col gap-4">
              {NEEDS.map(([title, text]) => (
                <li key={title} className="flex items-start gap-3">
                  <span className="pt-0.5">
                    <CheckIcon />
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[16px] font-semibold text-foreground">{title}</span>
                    <span className="text-[15px] text-muted">{text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      <section id="faq" className="pt-24">
        <Container className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-10">
          <div className="flex flex-col gap-3.5">
            <SectionHead eyebrow="FAQ" title="Questions, answered straight." lead="Something else? Ask in the Discord." />
            <Link href="/faq" className="text-[16px] font-semibold text-accent no-underline hover:text-accent-strong">
              Every question →
            </Link>
          </div>
          <FaqAccordion ids={LANDING_FAQ_IDS} />
        </Container>
      </section>

      <section id="support" className="pt-24">
        <Container className="flex flex-col gap-8">
          <SectionHead
            eyebrow="Support"
            title="Dawn stays free. Supporters keep it growing."
            lead="Hi, I'm Angel, and I build The Dawn Project on my own. Support pays for development time, new amp tones, drum grooves and sound packs. Core features are never behind a paywall."
            className="max-w-[720px]"
          />
          <Tiers tiers={TIERS} variant="perks" />
          <div className="flex flex-wrap items-center gap-2.5">
            {others.length > 0 && <span className="pr-1 text-[14px] text-muted">Also on</span>}
            {others.map(([url, label]) => (
              <a key={label} href={url} target="_blank" rel="noreferrer" className="flex min-h-11 items-center rounded-[10px] border border-border bg-surface px-5 text-[15px] text-foreground no-underline hover:border-border-strong">
                {label}
              </a>
            ))}
            <Link href="/support" className="px-2 text-[15px] font-semibold text-accent no-underline hover:text-accent-strong">
              More ways to help →
            </Link>
          </div>
        </Container>
      </section>

      <CtaBand />
    </>
  );
}
