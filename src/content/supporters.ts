// The members thanked by name in the Credits, from supporters.json: the
// Producer tier's members first ("Producers"), then Supporter and Studio
// members ("Supporters"), as the tiers in tiers.ts promise.

import data from "./supporters.json";

export interface SupporterLists {
  producers: string[];
  supporters: string[];
}

export const MEMBERS: SupporterLists = { producers: data.producers, supporters: data.supporters };

/** Names longer than this don't fit the Credits' layout. */
const MAX_NAME = 40;

/** What's wrong with the lists (empty when they're fine): blank or overlong
 * names, and anyone listed twice. */
export function supporterProblems(lists: SupporterLists): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [list, names] of Object.entries(lists) as [keyof SupporterLists, string[]][]) {
    for (const name of names) {
      if (typeof name !== "string" || !name.trim()) problems.push(`${list}: a blank name`);
      else if (name.length > MAX_NAME) problems.push(`${list}: "${name}" is longer than ${MAX_NAME} characters`);
      else if (seen.has(name.trim().toLowerCase())) problems.push(`${list}: "${name}" is listed twice`);
      else seen.add(name.trim().toLowerCase());
    }
  }
  return problems;
}
