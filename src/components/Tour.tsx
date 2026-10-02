"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

// A four-step tour of the studio, shown once after the first visit's start
// screen and reopenable from Help. Each step points at an element marked
// with data-tour="…"; if it isn't on screen, the card sits in the middle.

const DONE_KEY = "dawn.tourDone";

export function tourDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === "1";
  } catch {
    return false;
  }
}

function markTourDone() {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {
    // Private windows: it shows again next visit, which is harmless.
  }
}

interface Step {
  target: string;
  title: string;
  text: string;
}

export const TOUR_STEPS: Step[] = [
  {
    target: "transport",
    title: "Play and record",
    text: "The transport: play, stop and Record (or press R). The metronome, count-in, tempo and time signature are here too.",
  },
  {
    target: "track",
    title: "Tracks",
    text: "Arm a track with its red button, then press R. Audio tracks record your guitar or mic, MIDI tracks your keyboard. Drag clips to move them; double-click a MIDI clip to edit its notes.",
  },
  {
    target: "browser",
    title: "Effects, tones and grooves",
    text: "Drag an effect or a ready-made chain onto the selected track's rack. The Grooves tab has drum patterns to drop onto a drum track.",
  },
  {
    target: "export",
    title: "Export",
    text: "When it sounds right, export an MP3 or WAV of the song, or stems for another DAW. File → Save keeps the whole project on your computer.",
  },
];

const PAD = 6;
const CARD_W = 320;

type Box = { top: number; left: number; width: number; height: number };

function measure(target: string): Box | null {
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
}

/** Where the card goes: beside a tall target, else below it, else above. */
function cardPosition(box: Box | null): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.max(12, Math.min(vw - CARD_W - 12, x));
  if (!box) return { top: vh / 2 - 90, left: clampX(vw / 2 - CARD_W / 2) };
  if (box.height > vh * 0.5) return { top: Math.max(12, Math.min(vh - 220, box.top + 40)), left: clampX(box.left + box.width + 12) };
  if (box.top + box.height + 200 < vh) return { top: box.top + box.height + 12, left: clampX(box.left) };
  return { top: Math.max(12, box.top - 200), left: clampX(box.left) };
}

export function Tour({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const current = TOUR_STEPS[step];
  const last = step === TOUR_STEPS.length - 1;

  const finish = () => {
    markTourDone();
    onClose();
  };

  useEffect(() => {
    const update = () => setBox(measure(current.target));
    const frame = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
    };
  }, [current.target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The studio's own shortcuts (space, R...) wait while the tour is open.
      e.stopPropagation();
      if (e.key === "Escape") {
        markTourDone();
        onClose();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        if (step < TOUR_STEPS.length - 1) setStep(step + 1);
        else {
          markTourDone();
          onClose();
        }
      } else if (e.key === "ArrowLeft" && step > 0) setStep(step - 1);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [step, onClose]);

  const pos = typeof window === "undefined" ? { top: 0, left: 0 } : cardPosition(box);

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label={`Tour, step ${step + 1} of ${TOUR_STEPS.length}: ${current.title}`}>
      {box ? (
        <div
          className="pointer-events-none fixed rounded-lg ring-2 ring-accent transition-all duration-200"
          style={{ top: box.top, left: box.left, width: box.width, height: box.height, boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)" }}
        />
      ) : (
        <div className="fixed inset-0 bg-black/60" />
      )}
      <div
        className="fixed flex flex-col gap-2.5 rounded-xl border border-border bg-surface-raised p-4 shadow-2xl transition-all duration-200"
        style={{ top: pos.top, left: pos.left, width: CARD_W }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-accent">
            {step + 1} of {TOUR_STEPS.length}
          </span>
          <button type="button" onClick={finish} aria-label="Close the tour" className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-surface">
            <X size={14} />
          </button>
        </div>
        <h2 className="text-[15px] font-semibold">{current.title}</h2>
        <p className="text-[12.5px] leading-relaxed text-foreground/85">{current.text}</p>
        <div className="flex items-center justify-between gap-2 pt-1">
          {last ? (
            <span />
          ) : (
            <button type="button" onClick={finish} className="text-[12px] text-muted hover:text-foreground">
              Skip the tour
            </button>
          )}
          <div className="flex gap-2">
            {step > 0 && (
              <button type="button" onClick={() => setStep(step - 1)} className="rounded-md border border-border px-3 py-1.5 text-[12px] hover:bg-surface">
                Back
              </button>
            )}
            <button
              type="button"
              autoFocus
              onClick={() => (last ? finish() : setStep(step + 1))}
              className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-black hover:brightness-110"
            >
              {last ? "Start making music" : "Next"}
            </button>
          </div>
        </div>
        <p className="text-[10.5px] text-muted">Reopen it any time from Help.</p>
      </div>
    </div>
  );
}
