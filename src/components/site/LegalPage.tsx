import type { ReactNode } from "react";
import { Container, Eyebrow } from "./ui";

/** Credits, License and Privacy: the studio's own texts, at reading size. */
export function LegalPage({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <Container className="flex max-w-[800px] flex-col gap-6 pb-10 pt-[clamp(40px,6vw,72px)]">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className="font-display text-[clamp(36px,5vw,56px)] font-semibold leading-[1.05] tracking-[-1px] text-foreground">{title}</h1>
      <div className="flex flex-col gap-6 [&_h3]:text-[16px] [&_p]:text-[15.5px] [&_p]:leading-[1.65]">{children}</div>
    </Container>
  );
}
