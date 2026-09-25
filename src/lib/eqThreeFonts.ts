import { Fraunces, Space_Grotesk } from "next/font/google";

// The EQ Three plugin card's own distinct type identity (from the user's
// design) - a warm serif title plus a technical grotesk for labels, set
// apart from the rest of the app's plain sans UI the way a real outboard
// plugin's branding would be.
export const fraunces = Fraunces({ subsets: ["latin"], weight: ["600"], display: "swap" });
export const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600"], display: "swap" });
