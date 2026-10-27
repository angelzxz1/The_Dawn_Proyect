// The website's guides: one detailed tutorial per instrument and effect,
// shown at /guides/<slug>. Each is plain data, laid out by src/site/guide.tsx.

export interface GuideControl {
  name: string;
  /** Its range or choices, as shown on the knob. */
  range?: string;
  text: string;
}

export interface GuideGroup {
  title?: string;
  lead?: string;
  controls: GuideControl[];
}

export interface GuideRecipe {
  title: string;
  sound: string;
  steps: string[];
}

export interface GuideSection {
  id: string;
  title: string;
  /** A shorter name for the page's contents list. */
  nav?: string;
  lead: string;
  paragraphs?: string[];
  steps?: { title: string; text: string }[];
  groups?: GuideGroup[];
  recipes?: GuideRecipe[];
  tips?: string[];
}

export interface GuideSummary {
  slug: string;
  name: string;
  kind: "Instrument" | "Effect";
  summary: string;
}

/** Every guide there is, in the order the index lists them. */
export const GUIDES: GuideSummary[] = [
  {
    slug: "daybreak",
    name: "Daybreak",
    kind: "Instrument",
    summary: "The wavetable synth: oscillators, filters, envelopes, LFOs, modulation and the presets, knob by knob.",
  },
];
