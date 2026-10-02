import type { Metadata } from "next";
import Link from "next/link";
import { PrivacyPolicy } from "@/components/PrivacyPolicy";

export const metadata: Metadata = {
  title: "Privacy · The Dawn Project",
  description: "What The Dawn Project stores, what it counts, and what it never collects.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-10">
      <header className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-icon.png" alt="" className="h-8 w-8 rounded-md" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Privacy</h1>
          <p className="text-xs text-muted">The Dawn Project</p>
        </div>
      </header>
      <PrivacyPolicy settingsHint="in the app, under About → Privacy" />
      <Link href="/" className="self-start rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-raised">
        Open Dawn
      </Link>
    </main>
  );
}
