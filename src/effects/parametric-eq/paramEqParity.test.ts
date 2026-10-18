import { renderParamEqParity } from "./paramEqParity";
import { describeEngineFixture } from "../../test/engineFixtures";

describeEngineFixture("The Parametric EQ's kernel", "param_eq", "paramEqParity", renderParamEqParity);
