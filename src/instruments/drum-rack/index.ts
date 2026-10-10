// The Drum Rack: its key, name, and the kit it keeps on the track. Its
// sound source is built in audio.ts, its card and window are in ui.tsx.

import { defineInstrument } from "../types";
import { defaultDrumKit, normalizeDrumKit } from "./drumParams";

export const drumRackInstrument = defineInstrument({
  type: "drums",
  label: "Drums",
  settings: { key: "drumParams", defaults: defaultDrumKit, normalize: normalizeDrumKit },
});
