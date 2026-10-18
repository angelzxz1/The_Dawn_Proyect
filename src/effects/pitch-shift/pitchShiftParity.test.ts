import { renderPitchShiftParity } from "./pitchShiftParity";
import { describeEngineFixture } from "../../test/engineFixtures";

describeEngineFixture("The Pitch Shift's processor", "pitch_shift", "pitchShiftParity", renderPitchShiftParity);
