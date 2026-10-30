import { renderDelayParity } from "./delayParity";
import { describeWebAudioFixture } from "../../test/webAudioParity";

describeWebAudioFixture("The Delay's nodes", "delay", "delayParity", renderDelayParity);
