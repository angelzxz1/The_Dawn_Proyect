import type { EffectUi } from "../ui/types";
import { ReverbRackCard } from "./ReverbRackCard";
import { ReverbWindow } from "./ReverbWindow";

export const reverbUi: EffectUi = { cardWidth: "w-80", RackCard: ReverbRackCard, Window: ReverbWindow };
