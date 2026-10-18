import { renderAmpParity } from "./ampParity";
import { describeEngineFixture } from "../../test/engineFixtures";

describeEngineFixture("The Furnace amp's kernel", "amp", "ampParity", renderAmpParity);
