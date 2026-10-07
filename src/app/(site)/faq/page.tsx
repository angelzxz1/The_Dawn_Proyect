import type { Metadata } from "next";
import Link from "next/link";
import { FaqBrowser } from "@/site/interactive";
import { Container, CtaBand, Eyebrow, h1Class, h2Class, leadClass, primaryButton, secondaryButton } from "@/site/ui";
import { ISSUES_URL, supportLink } from "@/site/siteLinks";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Everything people ask about The Dawn Project: recording, privacy, browsers, supporting and selling your music.",
};

export default function FaqPage() {
  const discord = supportLink("discord");
  return (
    <>
      <section>
        <Container className="flex flex-col gap-[22px] pt-[clamp(40px,6vw,80px)]">
          <Eyebrow>FAQ</Eyebrow>
          <h1 className={`${h1Class} max-w-[940px]`}>Questions, answered straight.</h1>
          <p className={`${leadClass} max-w-[680px] text-[clamp(17px,1.6vw,20px)]`}>
            Everything people ask about Dawn: recording, privacy, browsers and support. Can&rsquo;t find yours? Ask in the Discord.
          </p>
          <FaqBrowser />
        </Container>
      </section>

      <section aria-labelledby="ask-h" className="pt-[88px]">
        <Container>
          <div className="flex flex-wrap items-center justify-between gap-5 rounded-[18px] border border-border bg-surface p-[clamp(24px,4vw,40px)]">
            <div className="flex max-w-[620px] flex-col gap-2">
              <h2 id="ask-h" className={`${h2Class} text-[clamp(26px,2.8vw,34px)]`}>
                Still have a question?
              </h2>
              <p className={leadClass}>Ask in the Discord. Questions that come up often get added here.</p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <a href={discord || ISSUES_URL} target="_blank" rel="noreferrer" className={primaryButton}>
                {discord ? "Join the Discord" : "Ask on GitHub"}
              </a>
              <Link href="/how-it-works#setup" className={secondaryButton}>
                Read the setup guide
              </Link>
            </div>
          </div>
        </Container>
      </section>

      <CtaBand />
    </>
  );
}
