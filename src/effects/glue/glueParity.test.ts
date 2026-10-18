import { renderGlueParity } from "./glueParity";
import { describeEngineFixture } from "../../test/engineFixtures";

describeEngineFixture("The Glue Compressor's kernel", "glue", "glueParity", renderGlueParity);
