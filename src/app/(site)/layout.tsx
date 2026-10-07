import { SiteFooter, SiteHeader } from "@/site/SiteChrome";
import { siteFontVariables } from "@/site/siteFonts";

/** The website around the studio: landing, features, guides, FAQ, support
 * and the legal pages. The studio itself is at /app. */
export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <div className={`site ${siteFontVariables} flex min-h-screen w-full flex-1 flex-col`}>
      <header>
        <SiteHeader />
      </header>
      <main className="flex-1">{children}</main>
      <footer>
        <SiteFooter />
      </footer>
    </div>
  );
}
