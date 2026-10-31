import { renderTunerParity } from "./tunerParity";
import { describeWebAudioFixture } from "../../test/webAudioParity";

describeWebAudioFixture("The Tuner's nodes", "tuner", "tunerParity", renderTunerParity);
