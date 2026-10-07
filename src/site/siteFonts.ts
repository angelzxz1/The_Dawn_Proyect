import { Fraunces, JetBrains_Mono, Space_Grotesk } from "next/font/google";

// The website's type (the studio keeps Geist): Fraunces for headings, Space
// Grotesk for text, JetBrains Mono for numbers and file names. Exposed as
// CSS variables that globals.css maps to font-display / font-code.

const fraunces = Fraunces({ subsets: ["latin"], axes: ["opsz"], variable: "--font-fraunces" });
const grotesk = Space_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-grotesk" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], weight: "500", variable: "--font-jetbrains" });

export const siteFontVariables = `${fraunces.variable} ${grotesk.variable} ${jetbrains.variable}`;
