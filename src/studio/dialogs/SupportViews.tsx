"use client";

import { useEffect, useState } from "react";
import { Copy, Heart, MessageSquare, X } from "lucide-react";
import { RELEASES } from "@/content/whatsNew";
import { isBrave } from "@/project/projectFiles";
import { communityLink, feedbackDetails, supportLinks } from "@/services/support";
import { track } from "@/services/telemetry";
import { issueSummary } from "@/services/issues";
import { useShortcuts } from "@/ui/shortcuts";

const feedbackListeners = new Set<() => void>();

/** Opens the feedback window (FeedbackWindow, in the studio). Feedback
 * buttons only show where there's a Discord to send it to. */
export function openFeedback(where: string) {
  track("feedback_opened", { where });
  feedbackListeners.forEach((show) => show());
}

/** Feedback, bug reports and ideas go on Dawn's Discord. An invite can't
 * carry text, so this shows what to paste into the post - Dawn's version,
 * the browser and any problems Dawn noted - and copies it on the way. */
export function FeedbackWindow() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const show = () => {
      setCopied(false);
      setOpen(true);
    };
    feedbackListeners.add(show);
    return () => {
      feedbackListeners.delete(show);
    };
  }, []);
  useShortcuts("dialog", [{ keys: "escape", run: () => setOpen(false), whileTyping: true }], { enabled: open });

  const community = communityLink();
  if (!open || !community) return null;
  const details = feedbackDetails(navigator.userAgent, isBrave(), issueSummary());
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
    } catch {
      // No clipboard: the details are there to select and copy by hand.
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div role="dialog" aria-label="Feedback" className="flex w-[440px] max-w-full flex-col gap-3 rounded-2xl border border-border bg-surface-raised p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <p className="flex items-center gap-1.5 text-[14px] font-semibold text-foreground">
            <MessageSquare size={14} className="text-accent" /> Feedback and bug reports
          </p>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-muted hover:text-foreground">
            <X size={15} />
          </button>
        </div>
        <p className="text-[12.5px] leading-relaxed text-muted">
          They go on Dawn&apos;s Discord: post in <span className="text-foreground">#bug-reports</span> for a problem or{" "}
          <span className="text-foreground">#feature-ideas</span> for an idea, with your audio interface if it&apos;s about
          sound. Paste these details in, so it&apos;s clear what you&apos;re running:
        </p>
        <pre className="select-all whitespace-pre-wrap rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[11.5px] text-foreground">{details}</pre>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={community.url}
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              void copy();
              track("support_link_clicked", { where: "feedback", target: "discord" });
            }}
            className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-black hover:brightness-110"
          >
            Open the Discord
          </a>
          <button type="button" onClick={() => void copy()} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] hover:bg-surface">
            <Copy size={12} /> {copied ? "Copied" : "Copy details"}
          </button>
          <span className="text-[11px] text-muted">Opening the Discord copies them too.</span>
        </div>
      </div>
    </div>
  );
}

/** The About tab's support section: what support pays for, the pages, and feedback. */
export function SupportSection() {
  const links = supportLinks();
  const community = communityLink();
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
        <Heart size={14} className="text-record" /> Support Dawn
      </p>
      <p className="text-[12px] leading-relaxed text-muted">
        Dawn stays free for everyone. Support pays for development time, new amp tones, grooves and sound packs.
        Supporters get a new pack every month, early access to new features, and a vote on what comes next.
      </p>
      {links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {links.map((l) => (
            <a
              key={l.id}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              title={l.hint}
              onClick={() => track("support_link_clicked", { where: "about", target: l.id })}
              className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-black hover:brightness-110"
            >
              {l.label}
            </a>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {community && (
          <a
            href={community.url}
            target="_blank"
            rel="noreferrer"
            onClick={() => track("support_link_clicked", { where: "about", target: "discord" })}
            className="rounded-md border border-border px-3 py-1.5 text-[12px] hover:bg-surface-raised"
          >
            Join the {community.label}
          </a>
        )}
        {community && (
          <button type="button" onClick={() => openFeedback("about")} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] hover:bg-surface-raised">
            <MessageSquare size={12} /> Send feedback
          </button>
        )}
      </div>
    </div>
  );
}

/** The release notes, newest first. */
export function WhatsNew() {
  return (
    <div className="flex flex-col gap-5">
      {RELEASES.map((r, i) => (
        <section key={r.version} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[14px] font-semibold text-foreground">{r.title}</h3>
            <span className="font-mono text-[11px] text-muted">
              {r.version} · {r.date}
            </span>
          </div>
          <ul className={`flex flex-col gap-1.5 text-[12.5px] leading-relaxed ${i === 0 ? "text-foreground/90" : "text-muted"}`}>
            {r.items.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="text-accent">•</span>
                {item}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The thank-you after a finished export: never blocks, shown at most once a visit. */
export function PostExportNote({ onClose }: { onClose: () => void }) {
  const links = supportLinks();
  return (
    <div role="status" className="fixed bottom-4 right-4 z-40 flex w-[340px] flex-col gap-2.5 rounded-xl border border-border bg-surface-raised p-4 shadow-2xl">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-semibold text-foreground">Your demo is ready.</p>
        <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-foreground">
          <X size={14} />
        </button>
      </div>
      <p className="text-[12px] leading-relaxed text-muted">Dawn is free and made by one developer. If it helped you, you can support it here.</p>
      <div className="flex gap-2">
        {links[0] && (
          <a
            href={links[0].url}
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              track("support_link_clicked", { where: "export", target: links[0].id });
              onClose();
            }}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-black hover:brightness-110"
          >
            <Heart size={12} /> Support Dawn
          </a>
        )}
        <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-[12px] hover:bg-surface">
          Not now
        </button>
      </div>
    </div>
  );
}
