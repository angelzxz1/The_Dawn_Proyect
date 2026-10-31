import { renderReverbParity } from "./reverbParity";
import { describeWebAudioFixture } from "../../test/webAudioParity";

describeWebAudioFixture("The Reverb's nodes", "reverb", "reverbParity", renderReverbParity);
