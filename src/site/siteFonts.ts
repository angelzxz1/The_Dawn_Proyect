import { fraunces, jetbrainsMono, spaceGrotesk } from "../fonts/site";

// The website's type (the studio keeps Geist): Fraunces for headings, Space
// Grotesk for text, JetBrains Mono for numbers and file names. Exposed as
// CSS variables that globals.css maps to font-display / font-code. The
// fonts themselves are in src/fonts/ (scripts/fonts.mjs).

export const siteFontVariables = `${fraunces.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`;
