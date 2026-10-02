import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { Container, Eyebrow, OpenDawn, Sun, h1Class, leadClass, secondaryButton } from "@/components/site/ui";
import { siteFontVariables } from "@/lib/siteFonts";

export const metadata: Metadata = {
  title: "Page not found",
};

/** Any address that isn't a page (exported as 404.html, which the host serves). */
export default function NotFound() {
  return (
    <div className={`site ${siteFontVariables} flex min-h-screen w-full flex-1 flex-col`}>
      <header>
        <SiteHeader />
      </header>
      <main className="flex-1">
        <Container className="flex flex-col items-center gap-6 pt-[clamp(48px,8vw,104px)] text-center">
          <Eyebrow>404</Eyebrow>
          <h1 className={`${h1Class} max-w-[760px]`}>This page isn&rsquo;t here.</h1>
          <p className={`${leadClass} max-w-[520px]`}>The address may be mistyped, or the page has moved. Your projects are safe: they live on your computer.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <OpenDawn />
            <Link href="/" className={secondaryButton}>
              Go to the home page
            </Link>
          </div>
          <div className="mt-6 w-[min(520px,88%)]">
            <Sun />
          </div>
        </Container>
      </main>
      <footer>
        <SiteFooter />
      </footer>
    </div>
  );
}
