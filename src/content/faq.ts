// The website's questions and answers: all of them on /faq, a few on the
// landing page. Keep answers true to what Dawn does today.

import { membershipPlatforms } from "@/services/support";

export const FAQ_CATEGORIES = ["General", "Recording & guitar", "Projects & privacy", "Browsers & devices", "Support & money"] as const;
export type FaqCategory = (typeof FAQ_CATEGORIES)[number];

export interface Faq {
  id: string;
  category: FaqCategory;
  q: string;
  a: string;
}

export const FAQS: Faq[] = [
  { id: "free", category: "General", q: "Is Dawn really free?", a: "Yes. Dawn is free to use, with no account and no trial. Supporters get extras like sound packs and early access, but core features are never behind a paywall." },
  { id: "why-free", category: "General", q: "Why is it free?", a: "Anyone with an idea should be able to record it. Dawn is funded by people who choose to support it, not by ads or by locking features away." },
  { id: "who", category: "General", q: "Who makes Dawn?", a: "Dawn is built by Angel, one developer. Updates come out every month, and supporters vote on what gets built next." },
  { id: "open-source", category: "General", q: "Is Dawn open source?", a: "No. The code is public on GitHub so anyone can read it, but it isn't licensed for reuse: you can't copy it, change it or host your own copy. Using the app to make music is free and always will be. The License page has the details." },
  { id: "release", category: "General", q: "Can I release and sell music I make with Dawn?", a: "Yes. The music you make is yours to share, sell and license, with no payment or credit needed. That includes Dawn's built-in sounds as they appear in your songs; you just can't pass those sounds on by themselves, as a sample pack." },
  { id: "need", category: "Recording & guitar", q: "What do I need to record guitar?", a: "A guitar, an audio interface or USB guitar cable, wired headphones, and Chrome or Edge on a desktop computer. The setup guide walks you through it." },
  { id: "delay", category: "Recording & guitar", q: "How much delay will I hear?", a: "It depends on your hardware. Dawn shows the measured latency in its audio panel in the header. Wired headphones, fewer open tabs and lighter amp captures all help." },
  { id: "own-captures", category: "Recording & guitar", q: "Can I use my own NAM captures and IRs?", a: "Yes. Drop any .nam capture onto the NAM Amp, or any cabinet impulse response onto the IR Loader." },
  { id: "vocals", category: "Recording & guitar", q: "Can I record vocals?", a: "Yes. Use the Voice + Guitar template for a ready-made vocal chain with a gate, compressor, EQ and reverb send." },
  { id: "processed", category: "Recording & guitar", q: "Why does my recording sound processed?", a: "Dawn turns off the browser's voice-call processing. If it still sounds processed, turn off noise reduction or \"enhancements\" for the input in your operating system's sound settings." },
  { id: "saved", category: "Projects & privacy", q: "Where are my projects saved?", a: "In a folder on your own computer, with your audio, your settings and your undo history. Dawn also autosaves in the browser between saves." },
  { id: "private", category: "Projects & privacy", q: "Is my music private?", a: "Yes. Your projects never leave your computer. Analytics only counts actions like \"exported a song\"; it never collects audio, project content or personal data, and you can turn it off." },
  { id: "offline", category: "Projects & privacy", q: "Does it work offline?", a: "Once installed as an app from Chrome or Edge, Dawn opens without a connection and loads your saved projects." },
  { id: "other-daw", category: "Projects & privacy", q: "Can I move a project to another DAW?", a: "Yes. Export stems (one WAV per track, all starting together) and MIDI, then import them anywhere." },
  { id: "browsers", category: "Browsers & devices", q: "Which browsers are supported?", a: "Chrome and Edge on a desktop computer work best. Firefox and Safari work with some limits, which the setup guide explains." },
  { id: "mobile", category: "Browsers & devices", q: "Does it work on phones or tablets?", a: "Not yet. Mobile browsers have tighter limits on audio and files, so Dawn focuses on desktop computers for now." },
  { id: "vst", category: "Browsers & devices", q: "Can I use my VST plugins?", a: "Not in the browser. That's what the 18 built-in effects, the NAM Amp and the IR Loader are for. You can always export stems and finish in your main DAW." },
  { id: "chromebook", category: "Browsers & devices", q: "Does it work on a Chromebook?", a: "It should, in Chrome. Performance depends on the model; if you try it, tell us how it went in the Discord." },
  { id: "supporters", category: "Support & money", q: "What do supporters get?", a: "A monthly sound pack, early access to new features, a vote on what gets built next, and your name in the credits. See the Support page for each tier." },
  { id: "cancel", category: "Support & money", q: "Can I cancel at any time?", a: `Yes. Memberships are managed on ${membershipPlatforms().join(" or ")}, and you can cancel there whenever you like.` },
  { id: "one-time", category: "Support & money", q: "Can I support once instead of monthly?", a: "Yes. You can leave a one-time tip on Ko-fi." },
  { id: "bugs", category: "Support & money", q: "How do I report a bug or suggest a feature?", a: "Post in #bug-reports or #feature-ideas on the Discord, or open an issue on GitHub. Include your browser and audio interface." },
];

/** The questions on the landing page. */
export const LANDING_FAQ_IDS = ["free", "why-free", "private", "offline", "browsers", "vst"];
