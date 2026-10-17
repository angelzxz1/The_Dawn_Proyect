import { renderLimiterParity } from "./limiterParity";
import { describeEngineFixture } from "../../test/engineFixtures";

describeEngineFixture("The Limiter's processor", "limiter", "limiterParity", renderLimiterParity);
