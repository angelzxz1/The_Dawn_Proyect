import { renderMetronomeParity } from "./metronomeParity";
import { describeEngineFixture } from "../test/engineFixtures";

describeEngineFixture("The metronome's kernel", "metronome", "metronomeParity", renderMetronomeParity);
