import { renderIrLoaderParity } from "./irLoaderParity";
import { describeWebAudioFixture } from "../../test/webAudioParity";

describeWebAudioFixture("The IR Loader's nodes", "ir_loader", "irLoaderParity", renderIrLoaderParity);
