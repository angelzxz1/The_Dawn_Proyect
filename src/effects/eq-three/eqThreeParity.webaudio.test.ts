import { renderEqThreeParity } from "./eqThreeParity";
import { describeWebAudioFixture } from "../../test/webAudioParity";

describeWebAudioFixture("The EQ Three's node", "eq_three", "eqThreeParity", renderEqThreeParity);
