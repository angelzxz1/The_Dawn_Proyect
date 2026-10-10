// Every instrument's picker icon, rack card and window, from each
// instrument folder's ui.tsx.

import type { InstrumentType } from "../registry";
import type { InstrumentUi } from "./types";
import { pianoUi } from "../piano/ui";
import { drumRackUi } from "../drum-rack/ui";
import { synthUi } from "../synth/ui";

export const INSTRUMENT_UI: Record<InstrumentType, InstrumentUi> = {
  piano: pianoUi,
  drums: drumRackUi,
  synth: synthUi,
};
