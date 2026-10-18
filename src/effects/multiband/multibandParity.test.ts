import { renderMultibandParity } from "./multibandParity";
import { describeEngineFixture } from "../../test/engineFixtures";

describeEngineFixture("The Multiband Compressor's kernel", "multiband", "multibandParity", renderMultibandParity);
