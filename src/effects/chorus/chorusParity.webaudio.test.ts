import { renderChorusParity } from "./chorusParity";
import { describeWebAudioFixture } from "../../test/webAudioParity";

describeWebAudioFixture("The Chorus's nodes", "chorus", "chorusParity", renderChorusParity);
