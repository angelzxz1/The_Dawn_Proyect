import { synthParityFixture } from "./synthParity";
import { describeEngineFixture } from "../../test/engineFixtures";

describeEngineFixture("The synth's kernel", "synth", "synthParity", synthParityFixture);
