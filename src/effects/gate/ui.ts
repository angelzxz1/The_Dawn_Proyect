import type { EffectUi } from "../ui/types";
import { GateRackCard } from "./GateRackCard";
import { GateWindow } from "./GateWindow";

export const gateUi: EffectUi = { cardWidth: "w-72", RackCard: GateRackCard, Window: GateWindow };
