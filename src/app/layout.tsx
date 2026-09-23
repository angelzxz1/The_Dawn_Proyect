import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "The Dawn Project — Online DAW",
  description:
    "A browser-based digital audio workstation for recording and creating MIDI.",
  openGraph: {
    title: "The Dawn Project — Online DAW",
    description:
      "A browser-based digital audio workstation for recording and creating MIDI.",
    images: ["/banner.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "The Dawn Project — Online DAW",
    description:
      "A browser-based digital audio workstation for recording and creating MIDI.",
    images: ["/banner.png"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
