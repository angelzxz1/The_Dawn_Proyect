import type { Tier } from "@/site/interactive";

// The supporter memberships, as shown on the landing and Support pages.
// Keep these in step with the Patreon tiers.

export const TIERS: Tier[] = [
  { name: "Follower", price: 0, blurb: "Follow along for free.", cta: "Follow for free", perks: ["Public posts and release notes", "The monthly newsletter"] },
  {
    name: "Supporter",
    price: 3,
    blurb: "Your name in Dawn, for good.",
    cta: "Join Supporter",
    perks: ["Your name in the in-app credits", "Discord supporter role", "Behind-the-scenes devlog posts"],
  },
  {
    name: "Studio",
    price: 7,
    blurb: "The monthly pack, early access and a vote.",
    cta: "Join Studio",
    perks: ["Everything in Supporter", "The monthly sound pack on day one", "Early-access beta", "A vote on the next feature"],
  },
  {
    name: "Producer",
    price: 15,
    blurb: "Everything, plus time with me.",
    cta: "Join Producer",
    perks: ["Everything in Studio", "Monthly live Q&A or tone clinic", "A tone or preset request each quarter"],
  },
];

/** The comparison table: each perk and the first tier (by index) that has it. */
export const PERKS: [string, number][] = [
  ["Public posts, release notes and the newsletter", 0],
  ["Your name in the in-app credits", 1],
  ["Discord supporter role", 1],
  ["Behind-the-scenes devlog posts", 1],
  ["Monthly sound pack on day one", 2],
  ["Early-access beta", 2],
  ["Vote on the next feature", 2],
  ["Monthly live Q&A or tone clinic", 3],
  ["A tone or preset request each quarter", 3],
  ['Name in the "Producers" credits', 3],
];
