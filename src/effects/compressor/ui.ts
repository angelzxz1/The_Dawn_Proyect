import type { EffectUi } from "../ui/types";
import { CompressorRackCard } from "./CompressorRackCard";
import { CompressorWindow } from "./CompressorWindow";

export const compressorUi: EffectUi = { cardWidth: "w-72", RackCard: CompressorRackCard, Window: CompressorWindow };
