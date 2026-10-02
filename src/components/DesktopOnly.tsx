"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { Check, Copy, Share2 } from "lucide-react";
import { siteFontVariables } from "@/lib/siteFonts";
import { Sun } from "./site/ui";

// Phones and touch-only tablets: no fine pointer (mouse or trackpad) at all.
// Touchscreen laptops and iPads with a trackpad have one, so they get the studio.
const TOUCH_ONLY = "(pointer: coarse)";
const FINE = "(any-pointer: fine)";
const FORCED_KEY = "dawn.openOnTouch";

function subscribe(onChange: () => void) {
  const queries = [matchMedia(TOUCH_ONLY), matchMedia(FINE)];
  queries.forEach((q) => q.addEventListener("change", onChange));
  return () => queries.forEach((q) => q.removeEventListener("change", onChange));
}

const touchOnly = () => matchMedia(TOUCH_ONLY).matches && !matchMedia(FINE).matches;

function readForced(): boolean {
  try {
    return sessionStorage.getItem(FORCED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Shows the studio on computers, and a short note on phones and tablets:
 * Dawn needs a computer's audio, screen and keyboard. The note's "Open
 * anyway" lets a tablet with a keyboard try it. Until the device is known
 * (the static page, before scripts run) it shows `loading`. */
export function DesktopOnly({ children, loading }: { children: ReactNode; loading: ReactNode }) {
  const device = useSyncExternalStore(subscribe, () => (touchOnly() ? "touch" : "desktop"), () => "unknown");
  const [forced, setForced] = useState(readForced);
  if (device === "unknown") return loading;
  if (device === "desktop" || forced) return children;
  return (
    <MobileNotice
      onOpenAnyway={() => {
        try {
          sessionStorage.setItem(FORCED_KEY, "1");
        } catch {
          // The choice then lasts until the page closes.
        }
        setForced(true);
      }}
    />
  );
}

function MobileNotice({ onOpenAnyway }: { onOpenAnyway: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = typeof location === "undefined" ? "" : `${location.origin}/app`;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const sendLink = async () => {
    if (canShare) {
      await navigator.share({ title: "The Dawn Project", text: "Open Dawn on your computer:", url }).catch(() => undefined);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // No clipboard either: the address is shown on the page to copy by hand.
    }
  };

  return (
    <main className={`site ${siteFontVariables} flex min-h-dvh w-full flex-col items-center overflow-hidden px-5 pt-[clamp(48px,12vh,120px)] text-center`}>
      <div className="flex w-full max-w-[440px] flex-col items-center gap-5">
        <p className="text-[12px] font-semibold uppercase tracking-[2.4px] text-accent">Desktop only, for now</p>
        <h1 className="font-display text-[clamp(34px,9vw,48px)] font-semibold leading-[1.05] tracking-[-0.8px] text-foreground">
          Dawn needs a computer.
        </h1>
        <p className="text-[16.5px] leading-[1.6] text-soft">
          Recording, amp models and mixing need a computer&rsquo;s audio, screen and keyboard. Open Dawn in Chrome or Edge on a desktop or laptop, and
          everything is ready there.
        </p>
        <button
          type="button"
          onClick={() => void sendLink()}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2.5 rounded-[10px] bg-accent px-6 text-[16px] font-semibold text-background hover:bg-accent-strong"
        >
          {copied ? <Check size={17} /> : canShare ? <Share2 size={17} /> : <Copy size={17} />}
          {copied ? "Link copied" : canShare ? "Send the link to my computer" : "Copy the link"}
        </button>
        {url && <p className="font-code text-[13px] text-muted">{url.replace(/^https?:\/\//, "")}</p>}
        <Link
          href="/"
          className="inline-flex min-h-12 w-full items-center justify-center rounded-[10px] border border-border bg-surface px-6 text-[16px] font-medium text-foreground no-underline"
        >
          See what Dawn can do
        </Link>
        <button type="button" onClick={onOpenAnyway} className="min-h-11 px-3 text-[14px] text-muted underline underline-offset-4">
          Open the studio anyway
        </button>
      </div>
      <div className="mt-auto w-[min(420px,90%)] pt-10">
        <Sun />
      </div>
    </main>
  );
}
