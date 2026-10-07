import type { EffectUi } from "../ui/types";
import { PitchShiftRackCard } from "./PitchShiftRackCard";
import { PitchShiftWindow } from "./PitchShiftWindow";

export const pitchShiftUi: EffectUi = { cardWidth: "w-72", RackCard: PitchShiftRackCard, Window: PitchShiftWindow };
