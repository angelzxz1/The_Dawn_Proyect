import { renderMbDynamicsParity } from "./mbDynamicsParity";
import { describeEngineFixture } from "../../test/engineFixtures";

describeEngineFixture("The Multiband Dynamics kernel", "mb_dynamics", "mbDynamicsParity", renderMbDynamicsParity);
