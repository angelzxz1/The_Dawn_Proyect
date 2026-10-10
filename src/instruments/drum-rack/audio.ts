// How the Drum Rack is built from a track's kit, and a new kit applied.

import { defineInstrumentAudio } from "../types";
import { DrumRack } from "./drumRack";
import { defaultDrumKit } from "./drumParams";

export const drumRackAudio = defineInstrumentAudio<DrumRack>({
  create(settings, onSettled) {
    const rack = new DrumRack(settings.drumParams ?? defaultDrumKit());
    void rack.ready.then(onSettled, onSettled);
    return rack;
  },
  update(rack, settings) {
    if (settings.drumParams) rack.setKit(settings.drumParams);
  },
});
