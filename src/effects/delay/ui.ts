import type { EffectUi } from "../ui/types";
import { DelayRackCard } from "./DelayRackCard";
import { DelayWindow } from "./DelayWindow";

export const delayUi: EffectUi = { cardWidth: "w-72", RackCard: DelayRackCard, Window: DelayWindow };
