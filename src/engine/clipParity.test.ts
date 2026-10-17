import { renderClipParity } from "./clipParity";
import { describeEngineFixture } from "../test/engineFixtures";

describeEngineFixture("mixClip", "clips", "clipParity", renderClipParity);
