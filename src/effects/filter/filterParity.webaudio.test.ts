import { renderFilterParity } from "./filterParity";
import { describeWebAudioFixture } from "../../test/webAudioParity";

describeWebAudioFixture("The Filter's nodes", "filter", "filterParity", renderFilterParity);
