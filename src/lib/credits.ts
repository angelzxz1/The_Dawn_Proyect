// What Dawn is built on and ships with, from src/content/licenses.json:
// the Credits screen lists it, and the test checks every entry is complete.

import data from "../content/licenses.json";

export type CreditKind = "software" | "sound" | "font" | "original";

export interface CreditEntry {
  id: string;
  name: string;
  kind: CreditKind;
  author: string;
  license: string;
  licenseUrl?: string;
  url?: string;
  usedFor: string;
  /** Where the file came from, for anything bundled or loaded. */
  source?: string;
  /** When it was added (and, for content used with permission, when it was given). */
  added?: string;
  /** How permission was given, for content that isn't under an open license. */
  permission?: string;
}

export const CREDIT_KINDS: { kind: CreditKind; title: string }[] = [
  { kind: "sound", title: "Sounds" },
  { kind: "original", title: "Made for Dawn" },
  { kind: "software", title: "Software" },
  { kind: "font", title: "Fonts" },
];

export const CREDITS: CreditEntry[] = data.entries as CreditEntry[];

export function creditsOfKind(kind: CreditKind, entries: CreditEntry[] = CREDITS): CreditEntry[] {
  return entries.filter((e) => e.kind === kind);
}

/** What's missing or wrong in the list (empty when it's fine). */
export function creditProblems(entries: CreditEntry[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const kinds = new Set(CREDIT_KINDS.map((k) => k.kind));
  for (const e of entries) {
    const label = e.id || e.name || "(unnamed)";
    if (!e.id) problems.push(`${label}: no id`);
    else if (ids.has(e.id)) problems.push(`${label}: duplicate id`);
    ids.add(e.id);
    for (const field of ["name", "author", "license", "usedFor"] as const) {
      if (typeof e[field] !== "string" || !e[field].trim()) problems.push(`${label}: no ${field}`);
    }
    if (!kinds.has(e.kind)) problems.push(`${label}: unknown kind "${e.kind}"`);
    // Sounds are what licensing trouble comes from: say where they came from and when.
    if (e.kind === "sound" && (!e.source || !e.added)) problems.push(`${label}: sounds need a source and the date they were added`);
    for (const field of ["url", "licenseUrl"] as const) {
      const v = e[field];
      if (v !== undefined && !/^https:\/\//.test(v)) problems.push(`${label}: ${field} isn't an https link`);
    }
  }
  return problems;
}
