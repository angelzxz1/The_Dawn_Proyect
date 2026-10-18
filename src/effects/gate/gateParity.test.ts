import { renderGateParity } from "./gateParity";
import { describeEngineFixture } from "../../test/engineFixtures";

describeEngineFixture("The Noise Gate's kernel", "gate", "gateParity", renderGateParity);
