import { renderSaturatorParity } from "./saturatorParity";
import { describeWebAudioFixture } from "../../test/webAudioParity";

describeWebAudioFixture("The Saturator's nodes", "saturator", "saturatorParity", renderSaturatorParity);
