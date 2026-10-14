import type { EffectUi } from "../ui/types";
import { LimiterRackCard } from "./LimiterRackCard";
import { LimiterWindow } from "./LimiterWindow";

export const limiterUi: EffectUi = { cardWidth: "w-72", RackCard: LimiterRackCard, Window: LimiterWindow };
