import type { Metadata, Viewport } from "next";
import { geist, geistMono } from "@/fonts/geist";
import "@/fonts/alphabets.css";
import "./globals.css";
import { SITE_URL } from "@/site/siteUrl";

const SUMMARY =
  "Record guitar through real amp models, make beats, mix with 18 studio effects and export your song, in a browser tab. Free, with nothing to install and no account.";

export const metadata: Metadata = {
  // Where the site lives, for absolute social-card image links. Set
  // NEXT_PUBLIC_SITE_URL when deploying (see docs/deploy.md).
  metadataBase: new URL(SITE_URL),
  title: { default: "The Dawn Project — Your studio, one tab away", template: "%s · The Dawn Project" },
  applicationName: "The Dawn Project",
  appleWebApp: { capable: true, title: "Dawn", statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/apple-touch-icon.png" },
  description: SUMMARY,
  openGraph: {
    title: "The Dawn Project — Your studio, one tab away",
    description: SUMMARY,
    images: ["/banner.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "The Dawn Project — Your studio, one tab away",
    description: SUMMARY,
    images: ["/banner.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#131316",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
